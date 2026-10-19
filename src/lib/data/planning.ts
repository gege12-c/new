/** Lectures de la planification. La RLS limite chaque résultat à ce que l’appelant peut voir. */
import "server-only";
import { snapshotOf, type SessionSnapshot } from "@/lib/planning/snapshot";
import type { SessionState } from "@/lib/planning/status";
import type { CalendarSession, HistoryEntry, SessionComment, TemplateSummary } from "./planning-types";
import type { ServerSupabase } from "@/lib/supabase/server";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { WorkoutSchema, type Workout, type SessionSport } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { getThresholds } from "./athlete";

const LIST_COLUMNS =
  "id, athlete_id, scheduled_date, start_time, sport, title, objective, planned_duration_s, planned_distance_m, state, version, created_by, content";


type ListRow = Omit<CalendarSession, "pending" | "planned_distance_m" | "content" | "sport" | "state"> & {
  sport: string;
  state: string;
  content: unknown;
  planned_distance_m: number | string | null;
  pending?: { updated_at: string } | null;
};

/**
 * Contenu normalisé (valeurs par défaut du format appliquées), même s'il a été écrit hors de
 * l'éditeur. Un contenu invalide est rendu tel quel : la base n'en contrôle que la forme générale.
 */
function normalizeContent(raw: unknown): Workout {
  const parsed = WorkoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : (raw as Workout);
}

function toCalendarSession(row: ListRow): CalendarSession {
  return {
    ...row,
    sport: row.sport as SessionSport,
    state: row.state as SessionState,
    content: normalizeContent(row.content),
    planned_distance_m: row.planned_distance_m === null ? null : Number(row.planned_distance_m),
    pending: Boolean(row.pending),
  };
}

/** Séances d’un athlète entre deux dates locales incluses, dans l’ordre du calendrier. */
export async function getSessionsInRange(
  supabase: ServerSupabase,
  athleteId: string,
  from: string,
  to: string,
  options: { withPending?: boolean } = {},
): Promise<CalendarSession[]> {
  const columns = options.withPending ? `${LIST_COLUMNS}, pending:planned_session_drafts(updated_at)` : LIST_COLUMNS;
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(columns)
    .eq("athlete_id", athleteId)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as ListRow[]).map(toCalendarSession);
}

export interface SessionDetail extends CalendarSession {
  description: string | null;
  nutrition_notes: string | null;
  published_at: string | null;
  updated_at: string;
  template_id: string | null;
  snapshot: SessionSnapshot;
  /** Modifications en attente d’une séance publiée (la base de fusion reste côté serveur). */
  draft: { payload: SessionSnapshot; updated_at: string } | null;
}

export async function getSessionDetail(supabase: ServerSupabase, sessionId: string, options: { withDraft?: boolean } = {}) {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select(`${LIST_COLUMNS}, description, nutrition_notes, published_at, updated_at, template_id`)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as ListRow & { description: string | null; nutrition_notes: string | null; published_at: string | null; updated_at: string; template_id: string | null };
  let draft: SessionDetail["draft"] = null;
  if (options.withDraft) {
    const pending = await supabase.from("planned_session_drafts").select("payload, updated_at").eq("session_id", sessionId).maybeSingle();
    if (pending.error) throw pending.error;
    if (pending.data) {
      draft = {
        payload: snapshotOf(pending.data.payload as Parameters<typeof snapshotOf>[0]),
        updated_at: pending.data.updated_at,
      };
    }
  }
  const session = toCalendarSession({ ...row, pending: draft ? { updated_at: draft.updated_at } : null });
  return {
    ...session,
    description: row.description,
    nutrition_notes: row.nutrition_notes,
    published_at: row.published_at,
    updated_at: row.updated_at,
    template_id: row.template_id,
    snapshot: snapshotOf(row as unknown as Parameters<typeof snapshotOf>[0]),
    draft,
  } satisfies SessionDetail;
}

/** Seuils de l’athlète en vigueur à une date donnée. */
export async function getThresholdsOn(supabase: ServerSupabase, athleteId: string, date: string): Promise<AthleteThresholds> {
  return toAthleteThresholds(currentThresholds(await getThresholds(supabase, athleteId), date));
}


export async function getSessionComments(supabase: ServerSupabase, sessionId: string): Promise<SessionComment[]> {
  const { data, error } = await supabase
    .from("session_comments")
    .select("id, body, visibility, created_at, edited_at, author_id, author:profiles!session_comments_author_id_fkey(display_name)")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    visibility: c.visibility as SessionComment["visibility"],
    created_at: c.created_at,
    edited_at: c.edited_at,
    author_id: c.author_id,
    author_name: (c.author as { display_name: string } | null)?.display_name ?? "Compte supprimé",
  }));
}


/** Historique d’une séance, tiré du journal d’audit (les entrées de brouillon restent aux coachs). */
export async function getSessionHistory(supabase: ServerSupabase, sessionId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, occurred_at, action, actor_id, changes")
    .eq("entity_type", "planned_sessions")
    .eq("entity_id", sessionId)
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const actorIds = [...new Set((data ?? []).map((e) => e.actor_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const profiles = await supabase.from("profiles").select("id, display_name").in("id", actorIds);
    if (profiles.error) throw profiles.error;
    for (const p of profiles.data ?? []) names.set(p.id, p.display_name);
  }
  return (data ?? []).map((entry) => {
    const changes = (entry.changes ?? {}) as Record<string, unknown>;
    return {
      id: entry.id,
      occurred_at: entry.occurred_at,
      action: entry.action as HistoryEntry["action"],
      actor_name: entry.actor_id ? (names.get(entry.actor_id) ?? "Ancien coach") : "Système",
      fields: Object.keys(changes),
      changes,
    };
  });
}


export async function getTemplates(supabase: ServerSupabase, ownerId: string): Promise<TemplateSummary[]> {
  const { data, error } = await supabase
    .from("workout_templates")
    .select("id, name, sport, objective, description, content, planned_duration_s, tags, updated_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("sport", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, sport: t.sport as SessionSport, content: t.content as Workout }));
}

export async function getTemplate(supabase: ServerSupabase, templateId: string): Promise<TemplateSummary | null> {
  const { data, error } = await supabase
    .from("workout_templates")
    .select("id, name, sport, objective, description, content, planned_duration_s, tags, updated_at")
    .eq("id", templateId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, sport: data.sport as SessionSport, content: data.content as Workout } : null;
}

export type { CalendarEvent, CalendarSession, HistoryEntry, SessionComment, TemplateSummary } from "./planning-types";
