"use server";

/**
 * Server Actions de l'espace connecté. Chacune revalide l'entrée (Zod), relit la session,
 * puis laisse la base appliquer les droits (RLS) : aucune autorisation ne repose sur le navigateur.
 */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { done, fail, firstIssue, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";
import { parsePace, thresholdDef } from "@/lib/thresholds";

const uuid = z.uuid("Identifiant invalide.");
const isoDate = z.iso.date("Date invalide.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .transform((v) => (v === "" ? null : v));

async function sessionOrFail() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

// ---------------------------------------------------------------------------
// Compte
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  display_name: z.string().trim().min(1, "Indiquez un nom.").max(80, "80 caractères maximum."),
  timezone: z.string().trim().min(1, "Choisissez un fuseau horaire.").max(64),
  is_coach: z.literal("on").optional(),
});

export async function updateAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, userId } = await sessionOrFail();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.display_name,
      timezone: parsed.data.timezone,
      is_coach: parsed.data.is_coach === "on",
    })
    .eq("id", userId);
  if (error) return fail(friendlyError(error));
  refresh();
  return done("Réglages enregistrés.");
}

// ---------------------------------------------------------------------------
// Profil sportif
// ---------------------------------------------------------------------------

const athleteProfileSchema = z.object({
  main_goal: optionalText(300),
  experience_level: z.enum(["", "beginner", "intermediate", "advanced", "elite"]).transform((v) => (v === "" ? null : v)),
  weekly_hours_target: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 40) {
        ctx.addIssue({ code: "custom", message: "Volume hebdomadaire : entre 0 et 40 heures." });
        return z.NEVER;
      }
      return Math.round(n * 10) / 10;
    }),
  notes: optionalText(2000),
});

export async function updateAthleteProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = athleteProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, userId } = await sessionOrFail();
  const { data, error } = await supabase.from("athlete_profiles").update(parsed.data).eq("user_id", userId).select("user_id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("Profil sportif introuvable.");
  refresh();
  return done("Objectifs enregistrés.");
}

// ---------------------------------------------------------------------------
// Seuils (athlète lui-même, ou coach autorisé à planifier)
// ---------------------------------------------------------------------------

const thresholdSchema = z.object({
  athlete_id: uuid,
  key: z.string().min(3),
  value: z.string().trim().min(1, "Saisissez une valeur."),
  effective_from: isoDate,
  notes: optionalText(500),
});

export async function addThreshold(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = thresholdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const [sport, metric] = parsed.data.key.split(".");
  const def = thresholdDef(sport, metric);
  if (!def) return fail("Seuil inconnu.");

  const value = def.input === "pace" ? parsePace(parsed.data.value) : Number(parsed.data.value.replace(",", "."));
  if (value === null || !Number.isFinite(value)) {
    return fail(def.input === "pace" ? "Allure illisible : utilisez le format min:s, par exemple 4:10." : "Valeur numérique attendue.");
  }
  if (value < def.min || value > def.max) return fail(`${def.label} : valeur hors limites.`);

  const { supabase } = await sessionOrFail();
  const row = { athlete_id: parsed.data.athlete_id, sport, metric, value, effective_from: parsed.data.effective_from, notes: parsed.data.notes };
  const inserted = await supabase.from("athlete_thresholds").insert(row);
  if (inserted.error?.code === "23505") {
    // Même seuil à la même date : on remplace la valeur.
    const updated = await supabase
      .from("athlete_thresholds")
      .update({ value, notes: parsed.data.notes })
      .match({ athlete_id: row.athlete_id, sport, metric, effective_from: row.effective_from })
      .select("id");
    if (updated.error) return fail(friendlyError(updated.error));
    if (!updated.data?.length) return fail("Vous n'avez pas les droits pour modifier ce seuil.");
  } else if (inserted.error) {
    return fail(friendlyError(inserted.error));
  }
  refresh();
  return done(`Seuil enregistré : ${def.label} (${def.group.toLowerCase()}).`);
}

export async function deleteThreshold(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase } = await sessionOrFail();
  await supabase.from("athlete_thresholds").delete().eq("id", id.data);
  refresh();
}

// ---------------------------------------------------------------------------
// Compétitions
// ---------------------------------------------------------------------------

const eventSchema = z.object({
  athlete_id: uuid,
  name: z.string().trim().min(1, "Nommez la compétition.").max(120),
  event_date: isoDate,
  priority: z.enum(["A", "B", "C"]),
  sport: z.enum(["triathlon", "duathlon", "run", "bike", "swim", "other"]),
  distance_label: optionalText(60),
  location: optionalText(120),
});

export async function addEvent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = eventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase } = await sessionOrFail();
  const { error } = await supabase.from("athlete_events").insert(parsed.data);
  if (error) return fail(friendlyError(error));
  refresh();
  return done("Compétition ajoutée.");
}

export async function deleteEvent(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase } = await sessionOrFail();
  await supabase.from("athlete_events").delete().eq("id", id.data);
  refresh();
}

// ---------------------------------------------------------------------------
// Invitations et relations
// ---------------------------------------------------------------------------

const invitationSchema = z.object({
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .pipe(z.email("Adresse email invalide.").nullable()),
  valid_days: z.coerce.number().int().min(1).max(30),
});

export async function createInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = invitationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase } = await sessionOrFail();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_email: parsed.data.email ?? undefined,
    p_valid_hours: parsed.data.valid_days * 24,
  });
  const invitation = data?.[0];
  if (error || !invitation) return fail(friendlyError(error));
  const link = `${await getSiteUrl()}/invite/${invitation.token}`;
  refresh();
  return done(undefined, { link, email: parsed.data.email ?? "", expiresAt: invitation.expires_at });
}

export async function revokeInvitation(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { supabase } = await sessionOrFail();
  await supabase.rpc("revoke_invitation", { p_invitation_id: id.data });
  refresh();
}

export async function acceptInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = z.string().min(32).max(128).safeParse(formData.get("token"));
  if (!token.success) return fail(friendlyError({ message: "invalid_invitation" }));
  const { supabase } = await sessionOrFail();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) return fail(friendlyError(error));
  redirect("/athlete?joined=1");
}

export async function revokeCoachLink(formData: FormData) {
  const id = uuid.safeParse(formData.get("link_id"));
  if (!id.success) return;
  const { supabase } = await sessionOrFail();
  await supabase.rpc("revoke_coach_link", { p_link_id: id.data });
  const back = formData.get("redirect_to");
  if (back === "/coach") redirect("/coach");
  refresh();
}

const permissionsSchema = z.object({
  link_id: uuid,
  can_edit_plan: z.literal("on").optional(),
  can_view_activities: z.literal("on").optional(),
});

export async function setCoachPermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = permissionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase } = await sessionOrFail();
  const { error } = await supabase.rpc("set_coach_permissions", {
    p_link_id: parsed.data.link_id,
    p_can_edit_plan: parsed.data.can_edit_plan === "on",
    p_can_view_activities: parsed.data.can_view_activities === "on",
  });
  if (error) return fail(friendlyError(error));
  refresh();
  return done("Permissions mises à jour.");
}
