"use server";

/**
 * Actions sur les activités réalisées : connexion Strava, import de fichiers FIT, rapprochements
 * manuels et déclarations de l'athlète. Les droits sont vérifiés par la base (RLS, fonctions).
 */
import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { localParts } from "@/lib/activities/local-time";
import { ImportBatchSchema } from "@/lib/activities/schema";
import { getProfile, getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { stravaDeps } from "@/lib/strava/deps";
import { disconnectStrava, enqueueSync, logSync, runDueJobs } from "@/lib/strava/service";

type Result = { status: "ok"; message?: string } | { status: "error"; message: string };

const uuid = z.uuid();
const NOT_CONFIGURED = "La connexion Strava n’est pas encore configurée sur ce site.";

async function sessionOrError() {
  const session = await getSession();
  if (!session) throw new Error("Votre session a expiré : reconnectez-vous.");
  return session;
}

export async function disconnectStravaAction(): Promise<Result> {
  const { userId } = await sessionOrError();
  const deps = stravaDeps();
  if (!deps) return { status: "error", message: NOT_CONFIGURED };
  const { revoked } = await disconnectStrava(deps, userId);
  refresh();
  return {
    status: "ok",
    message: revoked
      ? "Strava est déconnecté : vos données Strava ont été effacées de TriCoach."
      : "Vos données Strava ont été effacées de TriCoach. Strava n’a pas confirmé le retrait de l’accès : retirez TriCoach dans les réglages de votre compte Strava (Applications).",
  };
}

/** Relecture immédiate des 7 derniers jours (au plus une toutes les 5 minutes). */
export async function syncStravaNow(): Promise<Result> {
  const { supabase, userId } = await sessionOrError();
  const deps = stravaDeps();
  if (!deps) return { status: "error", message: NOT_CONFIGURED };
  const { data: connection } = await supabase.from("external_connections").select("id, status").eq("provider", "strava").maybeSingle();
  if (!connection) return { status: "error", message: "Connectez d’abord votre compte Strava." };
  if (connection.status !== "active") return { status: "error", message: "Reconnectez votre compte Strava pour reprendre la synchronisation." };
  // Hygiène : les activités Strava expirées (plus de 6 jours) sont effacées sans attendre la tâche quotidienne.
  await supabase.rpc("purge_my_expired_activities");
  const bucket = Math.floor(Date.now() / 300_000);
  await enqueueSync(deps, connection.id, userId, `manual:${bucket}`);
  after(() => runDueJobs(deps, { limit: 5, budgetMs: 40_000 }).catch(() => undefined));
  return { status: "ok", message: "Synchronisation lancée : vos activités arrivent dans quelques secondes." };
}

export type ImportResult = { status: "ok"; imported: number; duplicates: number } | { status: "error"; message: string };

/** Activités lues dans des fichiers FIT (sur l'appareil de l'athlète), contrôlées puis enregistrées. */
export async function importActivities(input: unknown): Promise<ImportResult> {
  const parsed = ImportBatchSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Fichier illisible." };
  const [{ supabase }, profile] = await Promise.all([sessionOrError(), getProfile()]);
  const rows = parsed.data.map((item) => {
    const local = localParts(new Date(item.start_time), item.utc_offset_s, profile.timezone);
    return {
      source: "fit_upload" as const,
      external_id: item.external_id,
      group_key: item.group_key,
      sport: item.sport,
      sport_detail: item.sport_detail,
      name: item.name,
      start_time: item.start_time,
      local_date: local.date,
      local_start_time: local.time,
      timezone: item.utc_offset_s === null ? profile.timezone : null,
      elapsed_s: item.elapsed_s,
      moving_s: item.moving_s,
      distance_m: item.distance_m,
      elevation_gain_m: item.elevation_gain_m,
      avg_hr: item.avg_hr,
      max_hr: item.max_hr,
      avg_power: item.avg_power,
      weighted_power: item.weighted_power,
      max_power: item.max_power,
      avg_cadence: item.avg_cadence,
      avg_speed_mps: item.avg_speed_mps,
      trainer: item.trainer,
      manual: false,
      device_name: item.device_name,
    };
  });
  const { data, error } = await supabase
    .from("activities")
    .upsert(rows, { onConflict: "athlete_id,source,external_id", ignoreDuplicates: true })
    .select("id");
  if (error) return { status: "error", message: friendlyError(error, "L’import a échoué.") };
  refresh();
  return { status: "ok", imported: data?.length ?? 0, duplicates: rows.length - (data?.length ?? 0) };
}

export async function deleteImportedActivity(activityId: string): Promise<Result> {
  if (!uuid.safeParse(activityId).success) return { status: "error", message: "Activité invalide." };
  const { supabase } = await sessionOrError();
  const { data, error } = await supabase.from("activities").delete().eq("id", activityId).eq("source", "fit_upload").select("id");
  if (error) return { status: "error", message: friendlyError(error) };
  if (!data?.length) return { status: "error", message: "Seules vos activités importées peuvent être supprimées." };
  refresh();
  return { status: "ok" };
}

export async function associateActivity(sessionId: string, activityId: string): Promise<Result> {
  if (!uuid.safeParse(sessionId).success || !uuid.safeParse(activityId).success) return { status: "error", message: "Association invalide." };
  const { supabase } = await sessionOrError();
  const { error } = await supabase.rpc("associate_activity", { p_session: sessionId, p_activity: activityId });
  if (error) return { status: "error", message: friendlyError(error, "L’association a échoué.") };
  refresh();
  return { status: "ok" };
}

export async function dissociateActivity(sessionId: string, activityId: string): Promise<Result> {
  if (!uuid.safeParse(sessionId).success || !uuid.safeParse(activityId).success) return { status: "error", message: "Action invalide." };
  const { supabase } = await sessionOrError();
  const { error } = await supabase.rpc("dissociate_activity", { p_session: sessionId, p_activity: activityId });
  if (error) return { status: "error", message: friendlyError(error, "L’action a échoué.") };
  refresh();
  return { status: "ok" };
}

const CompletionSchema = z.object({
  sessionId: uuid,
  status: z.enum(["done", "partial", "skipped"]),
  rpe: z.number().int().min(1).max(10).nullable(),
  note: z
    .string()
    .max(500, "500 caractères maximum.")
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

export async function declareCompletion(input: z.input<typeof CompletionSchema>): Promise<Result> {
  const parsed = CompletionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Déclaration invalide." };
  const { supabase } = await sessionOrError();
  const { sessionId, ...values } = parsed.data;
  // athlete_id est recopié de la séance par la base.
  const row = { session_id: sessionId, ...values } as TablesInsert<"session_completions">;
  const { error } = await supabase.from("session_completions").upsert(row, { onConflict: "session_id" });
  if (error) return { status: "error", message: friendlyError(error, "La déclaration n’a pas été enregistrée.") };
  refresh();
  return { status: "ok" };
}

export async function clearCompletion(sessionId: string): Promise<Result> {
  if (!uuid.safeParse(sessionId).success) return { status: "error", message: "Séance invalide." };
  const { supabase } = await sessionOrError();
  const { error } = await supabase.from("session_completions").delete().eq("session_id", sessionId);
  if (error) return { status: "error", message: friendlyError(error) };
  refresh();
  return { status: "ok" };
}

/** Journalise côté serveur un fichier refusé à l'import (sans son contenu). */
export async function reportImportFailure(reason: string): Promise<void> {
  const { userId } = await sessionOrError();
  const deps = stravaDeps();
  if (!deps) return;
  await logSync(deps.admin, { level: "warn", provider: "fit", event: "fit_import_rejected", message: reason.slice(0, 200), athleteId: userId }).catch(() => undefined);
}
