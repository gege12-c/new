"use server";

/**
 * Server Actions de la planification. Chaque entrée est validée (Zod), puis la base applique
 * les droits (RLS, triggers) et la fusion champ par champ : rien ne s’écrase en silence.
 */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { getSessionDetail, getThresholdsOn } from "@/lib/data/planning";
import { friendlyError } from "@/lib/errors";
import { isISODate, weekdayIndex } from "@/lib/planning/dates";
import {
  EDITABLE_FIELDS,
  SessionValuesSchema,
  SnapshotSchema,
  snapshotOf,
  type EditableField,
  type SessionSnapshot,
} from "@/lib/planning/snapshot";
import type { SessionState } from "@/lib/planning/status";
import { computeTotals, type WorkoutTotals } from "@/lib/workout/compute";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";
import { SESSION_OBJECTIVES, SESSION_SPORTS, WorkoutSchema } from "@/lib/workout/schema";

const uuid = z.uuid();
const isoDate = z.string().refine(isISODate, "Date invalide.");
const valid = <T extends z.ZodType>(schema: T, value: unknown) => schema.safeParse(value).success;

async function sessionOrRedirect() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Seuls les totaux exacts ou estimés sont enregistrés : une somme partielle mentirait. */
function storedTotals(totals: WorkoutTotals) {
  const keep = (status: string) => status === "exact" || status === "estimated";
  return {
    planned_duration_s: keep(totals.duration.status) && totals.duration.value > 0 ? Math.round(totals.duration.value) : null,
    planned_distance_m: keep(totals.distance.status) && totals.distance.value > 0 ? Math.round(totals.distance.value * 10) / 10 : null,
  };
}

type SessionRow = Parameters<typeof snapshotOf>[0] & { id: string; version: number; state: string; updated_at: string };

/**
 * `snapshot` est l’état enregistré après fusion : l’éditeur y reprend les changements faits
 * ailleurs sur les champs qu’il n’a pas touchés. `pending` : des modifications restent à publier.
 */
export type SaveSessionResult =
  | { status: "saved"; sessionId: string; state: SessionState; snapshot: SessionSnapshot; savedAt: string }
  | { status: "pending"; snapshot: SessionSnapshot; savedAt: string }
  | ConflictResult
  | { status: "invalid" | "error"; message: string };

/** `current` : l’état enregistré qui l’emporte pour l’instant ; `pending` : il s’agit de modifications en attente. */
export type ConflictResult = { status: "conflict"; fields: EditableField[]; current: SessionSnapshot | null; pending: boolean };

/** Réponse de save_session_draft et rebase_session_draft. */
type DraftResult = { payload: Parameters<typeof snapshotOf>[0]; pending: boolean; updated_at: string | null };

const SaveInputSchema = z.object({
  sessionId: uuid.nullable(),
  athleteId: uuid,
  templateId: uuid.nullable().optional(),
  base: SnapshotSchema.nullable(),
  values: SessionValuesSchema,
});

function conflictFields(details: string | null | undefined): EditableField[] {
  return (details ?? "").split(",").filter((f): f is EditableField => (EDITABLE_FIELDS as readonly string[]).includes(f));
}

/**
 * Conflit : rien n’a été écrit. `against` dit à quoi l’éditeur se compare : la séance publiée
 * (ou le brouillon de séance), ou les modifications en attente quand il y en a.
 */
async function conflictResult(
  supabase: Awaited<ReturnType<typeof sessionOrRedirect>>["supabase"],
  sessionId: string,
  details: string | null | undefined,
  against: "session" | "pending",
): Promise<ConflictResult> {
  const detail = await getSessionDetail(supabase, sessionId, { withDraft: against === "pending" }).catch(() => null);
  const draft = against === "pending" ? (detail?.draft ?? null) : null;
  return { status: "conflict", fields: conflictFields(details), current: draft?.payload ?? detail?.snapshot ?? null, pending: Boolean(draft) };
}

/**
 * Enregistre l’éditeur : création (brouillon), fusion directe pour un brouillon,
 * ou modifications en attente pour une séance déjà publiée.
 */
export async function saveSession(input: z.input<typeof SaveInputSchema>): Promise<SaveSessionResult> {
  const parsed = SaveInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", message: parsed.error.issues[0]?.message ?? "Séance invalide." };
  const { sessionId, athleteId, templateId, values } = parsed.data;
  // La base vient de la base de données elle-même (chargée par l’éditeur) : on la transmet telle quelle.
  const base = (parsed.data.base ?? {}) as Json;
  const { supabase } = await sessionOrRedirect();

  // Séance existante : ses totaux se calculent avec les seuils de son athlète, quoi qu’envoie le navigateur.
  const current = sessionId ? await supabase.from("planned_sessions").select("state, athlete_id").eq("id", sessionId).maybeSingle() : null;
  if (current?.error) return { status: "error", message: friendlyError(current.error) };
  if (current && !current.data) return { status: "error", message: "Cette séance n’existe plus ou ne vous est plus accessible." };

  const thresholds = await getThresholdsOn(supabase, current?.data?.athlete_id ?? athleteId, values.scheduled_date);
  const full = { ...values, ...storedTotals(computeTotals(values.content, thresholds)) };

  if (!sessionId || !current?.data) {
    const { data, error } = await supabase
      .from("planned_sessions")
      .insert({ athlete_id: athleteId, ...full, state: "draft", template_id: templateId ?? null })
      .select("*")
      .single();
    if (error) return { status: "error", message: friendlyError(error, "La séance n’a pas pu être créée.") };
    const row = data as unknown as SessionRow;
    return { status: "saved", sessionId: row.id, state: row.state as SessionState, snapshot: snapshotOf(row), savedAt: row.updated_at };
  }

  const direct = async (): Promise<SaveSessionResult> => {
    const { data, error } = await supabase.rpc("save_planned_session", { p_session: sessionId, p_base: base, p_values: full });
    if (error) {
      if (error.message.includes("session_conflict")) return conflictResult(supabase, sessionId, error.details, "session");
      return { status: "error", message: friendlyError(error, "L’enregistrement a échoué.") };
    }
    const row = data as unknown as SessionRow;
    return { status: "saved", sessionId, state: row.state as SessionState, snapshot: snapshotOf(row), savedAt: row.updated_at };
  };

  if (current.data.state === "draft") return direct();

  const { data, error } = await supabase.rpc("save_session_draft", { p_session: sessionId, p_base: base, p_payload: full });
  if (error) {
    // Repassée en brouillon entre-temps : on enregistre directement.
    if (error.message.includes("session_is_draft")) return direct();
    if (error.message.includes("session_conflict")) return conflictResult(supabase, sessionId, error.details, "pending");
    return { status: "error", message: friendlyError(error, "L’enregistrement a échoué.") };
  }
  const draft = data as unknown as DraftResult;
  const snapshot = snapshotOf(draft.payload);
  if (!draft.pending) {
    // Plus aucune différence avec la version publiée : rien n’est en attente.
    return { status: "saved", sessionId, state: current.data.state as SessionState, snapshot, savedAt: new Date().toISOString() };
  }
  return { status: "pending", snapshot, savedAt: draft.updated_at ?? new Date().toISOString() };
}

export type StateActionResult =
  | { status: "ok"; version?: number; snapshot?: SessionSnapshot; pending?: boolean }
  | ConflictResult
  | { status: "error"; message: string };

/** `refreshPage: false` depuis l’éditeur : son état local fait foi, inutile de relire la page. */
type PageOptions = { refreshPage?: boolean };
const PreferSchema = z.enum(["mine", "theirs"]);

/**
 * Publie un brouillon, ou les modifications en attente d’une séance publiée.
 * `prefer` tranche un conflit de publication (champ changé des deux côtés) : « mine » garde les modifications.
 */
export async function publishSession(sessionId: string, options: PageOptions & { prefer?: "mine" } = {}): Promise<StateActionResult> {
  if (!valid(uuid, sessionId) || (options.prefer !== undefined && !valid(PreferSchema, options.prefer))) {
    return { status: "error", message: "Séance invalide." };
  }
  const { supabase } = await sessionOrRedirect();
  const detail = await getSessionDetail(supabase, sessionId, { withDraft: true });
  if (!detail) return { status: "error", message: "Cette séance n’existe plus ou ne vous est plus accessible." };

  if (detail.state === "draft") {
    const { data, error } = await supabase
      .from("planned_sessions")
      .update({ state: "published" })
      .eq("id", sessionId)
      .eq("state", "draft")
      .select("*")
      .maybeSingle();
    if (error) return { status: "error", message: friendlyError(error, "La publication a échoué.") };
    if (options.refreshPage !== false) refresh();
    const row = data as unknown as SessionRow | null;
    return { status: "ok", version: row?.version, snapshot: row ? snapshotOf(row) : undefined };
  }
  if (detail.draft) {
    const { data, error } = await supabase.rpc("publish_session_draft", { p_session: sessionId, p_prefer: options.prefer });
    if (error) {
      if (error.message.includes("session_conflict")) return conflictResult(supabase, sessionId, error.details, "session");
      return { status: "error", message: friendlyError(error, "La publication a échoué.") };
    }
    if (options.refreshPage !== false) refresh();
    const row = data as unknown as SessionRow;
    return { status: "ok", version: row.version, snapshot: snapshotOf(row) };
  }
  return { status: "ok" };
}

/**
 * Conflit de publication résolu en faveur de la version publiée : les champs changés des deux côtés
 * reprennent la valeur publiée, les autres modifications restent en attente (rien n’est publié).
 */
export async function keepPublishedOnConflict(sessionId: string): Promise<StateActionResult> {
  if (!valid(uuid, sessionId)) return { status: "error", message: "Séance invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.rpc("rebase_session_draft", { p_session: sessionId, p_prefer: "theirs" });
  if (error) return { status: "error", message: friendlyError(error, "La résolution du conflit a échoué.") };
  const draft = data as unknown as DraftResult;
  return { status: "ok", snapshot: snapshotOf(draft.payload), pending: draft.pending };
}

/** Renonce aux modifications en attente : la version publiée reste inchangée. */
export async function discardPendingChanges(sessionId: string, options: PageOptions = {}): Promise<StateActionResult> {
  if (!valid(uuid, sessionId)) return { status: "error", message: "Séance invalide." };
  const { supabase } = await sessionOrRedirect();
  const { error } = await supabase.from("planned_session_drafts").delete().eq("session_id", sessionId);
  if (error) return { status: "error", message: friendlyError(error) };
  const detail = await getSessionDetail(supabase, sessionId);
  if (options.refreshPage !== false) refresh();
  return { status: "ok", version: detail?.version, snapshot: detail?.snapshot };
}

const TRANSITIONS = {
  unpublish: { from: ["published"], to: "draft" },
  cancel: { from: ["published", "draft"], to: "cancelled" },
  restore: { from: ["cancelled"], to: "published" },
} as const satisfies Record<string, { from: SessionState[]; to: SessionState }>;
const TransitionSchema = z.enum(["unpublish", "cancel", "restore"]);

export async function changeSessionState(
  sessionId: string,
  transition: keyof typeof TRANSITIONS,
  options: PageOptions = {},
): Promise<StateActionResult> {
  if (!valid(TransitionSchema, transition) || !valid(uuid, sessionId)) return { status: "error", message: "Action invalide." };
  const rule = TRANSITIONS[transition];
  const { supabase } = await sessionOrRedirect();
  // Aucune modification en attente ne disparaît en silence : il faut d’abord la publier ou l’abandonner.
  const pending = await supabase.from("planned_session_drafts").select("session_id").eq("session_id", sessionId).maybeSingle();
  if (pending.error) return { status: "error", message: friendlyError(pending.error) };
  if (pending.data) return { status: "error", message: "Publiez ou abandonnez d’abord les modifications en attente." };
  const { data, error } = await supabase
    .from("planned_sessions")
    .update({ state: rule.to })
    .eq("id", sessionId)
    .in("state", [...rule.from])
    .select("version")
    .maybeSingle();
  if (error) return { status: "error", message: friendlyError(error) };
  if (!data) return { status: "error", message: "L’état de la séance a changé entre-temps. Rechargez la page." };
  if (options.refreshPage !== false) refresh();
  return { status: "ok", version: data.version };
}

export async function moveSession(sessionId: string, fromDate: string, toDate: string): Promise<StateActionResult> {
  if (!valid(uuid, sessionId) || !valid(isoDate, fromDate) || !valid(isoDate, toDate)) {
    return { status: "error", message: "Déplacement invalide." };
  }
  if (fromDate === toDate) return { status: "ok" };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.rpc("save_planned_session", {
    p_session: sessionId,
    p_base: { scheduled_date: fromDate },
    p_values: { scheduled_date: toDate },
  });
  if (error) {
    if (error.message.includes("session_conflict")) return conflictResult(supabase, sessionId, error.details, "session");
    return { status: "error", message: friendlyError(error, "Le déplacement a échoué.") };
  }
  refresh();
  return { status: "ok", version: (data as unknown as SessionRow).version };
}

export async function duplicateSession(sessionId: string, date: string): Promise<{ status: "ok"; id: string } | { status: "error"; message: string }> {
  if (!valid(uuid, sessionId) || !valid(isoDate, date)) return { status: "error", message: "Duplication invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.rpc("duplicate_planned_session", { p_session: sessionId, p_date: date });
  if (error) return { status: "error", message: friendlyError(error, "La duplication a échoué.") };
  refresh();
  return { status: "ok", id: data };
}

export async function copyWeek(
  athleteId: string,
  fromMonday: string,
  toMonday: string,
  mode: "keep" | "draft",
): Promise<{ status: "ok"; count: number } | { status: "error"; message: string }> {
  if (!valid(uuid, athleteId) || !valid(isoDate, fromMonday) || !valid(isoDate, toMonday) || !valid(z.enum(["keep", "draft"]), mode)) {
    return { status: "error", message: "Copie invalide." };
  }
  if (weekdayIndex(fromMonday) !== 0 || weekdayIndex(toMonday) !== 0) return { status: "error", message: "Une semaine commence un lundi." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.rpc("copy_planned_week", {
    p_athlete: athleteId,
    p_from: fromMonday,
    p_to: toMonday,
    p_state: mode === "draft" ? "draft" : undefined,
  });
  if (error) return { status: "error", message: friendlyError(error, "La copie a échoué.") };
  refresh();
  return { status: "ok", count: data };
}

export async function deleteSession(sessionId: string): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  if (!valid(uuid, sessionId)) return { status: "error", message: "Séance invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.from("planned_sessions").delete().eq("id", sessionId).select("id");
  if (error) return { status: "error", message: friendlyError(error, "La suppression a échoué.") };
  if (!data?.length) return { status: "error", message: "Vous ne pouvez pas supprimer cette séance." };
  refresh();
  return { status: "ok" };
}

/** Planifie un modèle à une date, en brouillon, avec les totaux calculés pour l’athlète. */
export async function scheduleTemplate(
  athleteId: string,
  templateId: string,
  date: string,
): Promise<{ status: "ok"; id: string } | { status: "error"; message: string }> {
  if (!valid(uuid, athleteId) || !valid(uuid, templateId) || !valid(isoDate, date)) {
    return { status: "error", message: "Planification invalide." };
  }
  const { supabase } = await sessionOrRedirect();
  const template = await supabase.from("workout_templates").select("name, sport, objective, description, content").eq("id", templateId).maybeSingle();
  if (template.error || !template.data) return { status: "error", message: "Modèle introuvable." };
  const content = WorkoutSchema.safeParse(template.data.content);
  if (!content.success) return { status: "error", message: "Ce modèle n’est plus valide : ouvrez-le pour le corriger." };
  const thresholds = await getThresholdsOn(supabase, athleteId, date);
  const { data, error } = await supabase
    .from("planned_sessions")
    .insert({
      athlete_id: athleteId,
      scheduled_date: date,
      sport: template.data.sport,
      title: template.data.name,
      objective: template.data.objective,
      description: template.data.description,
      content: content.data,
      state: "draft",
      template_id: templateId,
      ...storedTotals(computeTotals(content.data, thresholds)),
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: friendlyError(error, "La planification a échoué.") };
  refresh();
  return { status: "ok", id: data.id };
}

// ---------------------------------------------------------------------------
// Bibliothèque de modèles
// ---------------------------------------------------------------------------

const TemplateSchema = z.object({
  templateId: uuid.nullable(),
  name: z.string().trim().min(1, "Donnez un nom au modèle.").max(120, "120 caractères maximum."),
  sport: z.enum(SESSION_SPORTS),
  objective: z.enum(SESSION_OBJECTIVES).nullable(),
  description: z
    .string()
    .max(4000)
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  content: WorkoutSchema,
});

export type SaveTemplateResult = { status: "saved"; templateId: string; savedAt: string } | { status: "invalid" | "error"; message: string };

export async function saveTemplate(input: z.input<typeof TemplateSchema>): Promise<SaveTemplateResult> {
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", message: parsed.error.issues[0]?.message ?? "Modèle invalide." };
  const { templateId, ...values } = parsed.data;
  const { supabase } = await sessionOrRedirect();
  const totals = computeTotals(values.content);
  const row = { ...values, planned_duration_s: totals.duration.status === "exact" ? Math.round(totals.duration.value) : null };
  const query = templateId
    ? supabase.from("workout_templates").update(row).eq("id", templateId).select("id, updated_at").single()
    : supabase.from("workout_templates").insert({ ...row, tags: [] }).select("id, updated_at").single();
  const { data, error } = await query;
  if (error) return { status: "error", message: friendlyError(error, "Le modèle n’a pas pu être enregistré.") };
  return { status: "saved", templateId: data.id, savedAt: data.updated_at };
}

export async function archiveTemplate(templateId: string): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  if (!valid(uuid, templateId)) return { status: "error", message: "Modèle invalide." };
  const { supabase } = await sessionOrRedirect();
  const { error } = await supabase.from("workout_templates").update({ archived_at: new Date().toISOString() }).eq("id", templateId);
  if (error) return { status: "error", message: friendlyError(error) };
  refresh();
  return { status: "ok" };
}

/** Enregistre le contenu d’une séance comme nouveau modèle de la bibliothèque. */
export async function saveSessionAsTemplate(
  sessionId: string,
  options: PageOptions = {},
): Promise<{ status: "ok"; id: string } | { status: "error"; message: string }> {
  if (!valid(uuid, sessionId)) return { status: "error", message: "Séance invalide." };
  const { supabase } = await sessionOrRedirect();
  const detail = await getSessionDetail(supabase, sessionId, { withDraft: true });
  if (!detail) return { status: "error", message: "Séance introuvable." };
  const source = detail.draft?.payload ?? detail.snapshot;
  const result = await saveTemplate({
    templateId: null,
    name: source.title,
    sport: source.sport,
    objective: (source.objective as (typeof SESSION_OBJECTIVES)[number] | null) ?? null,
    description: source.description,
    content: source.content,
  });
  if (result.status !== "saved") return { status: "error", message: result.message };
  if (options.refreshPage !== false) refresh();
  return { status: "ok", id: result.templateId };
}

// ---------------------------------------------------------------------------
// Commentaires
// ---------------------------------------------------------------------------

const CommentSchema = z.object({
  sessionId: uuid,
  body: z.string().trim().min(1, "Écrivez un commentaire.").max(4000, "4000 caractères maximum."),
  visibility: z.enum(["shared", "coach_private"]),
});

export async function addComment(input: z.input<typeof CommentSchema>): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const parsed = CommentSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Commentaire invalide." };
  const { supabase } = await sessionOrRedirect();
  // athlete_id et author_id sont posés par le trigger (et n’ont pas de privilège d’insertion).
  const row = { session_id: parsed.data.sessionId, body: parsed.data.body, visibility: parsed.data.visibility } as TablesInsert<"session_comments">;
  const { error } = await supabase.from("session_comments").insert(row);
  if (error) return { status: "error", message: friendlyError(error, "Le commentaire n’a pas pu être publié.") };
  refresh();
  return { status: "ok" };
}

export async function deleteComment(commentId: string): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  if (!valid(uuid, commentId)) return { status: "error", message: "Commentaire invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.from("session_comments").delete().eq("id", commentId).select("id");
  if (error) return { status: "error", message: friendlyError(error) };
  if (!data?.length) return { status: "error", message: "Vous ne pouvez supprimer que vos propres commentaires." };
  refresh();
  return { status: "ok" };
}
