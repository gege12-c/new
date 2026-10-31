/**
 * Relais intervals.icu, côté serveur : l'athlète relie son compte intervals.icu avec sa clé API
 * personnelle (chiffrée au repos, jamais renvoyée au navigateur) ; TriCoach dépose ensuite dans son
 * calendrier intervals.icu ses séances publiées des 14 prochains jours, qu'intervals.icu transmet
 * aux montres reliées chez lui (Suunto, Garmin, COROS).
 *
 * Synchronisation idempotente : chaque séance est déposée sous son identifiant externe (création ou
 * mise à jour), seulement quand elle a changé ; celles qui ne sont plus prévues sont retirées.
 *
 * Retour : les activités faites avec la montre, qu'intervals.icu reçoit de Suunto, Garmin ou COROS,
 * reviennent dans TriCoach (source « intervals ») ; celles qu'il tient de Strava ne sont pas
 * transmises par son API. Une activité retirée chez intervals.icu l'est aussi ici (période relue).
 */
import "server-only";
import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import {
  DeviceDeferError,
  DeviceReauthError,
  deviceLog,
  enqueueDailyDevice,
  enqueueDeviceSync,
  markReauth,
  runDeviceJobs,
  type DeviceConnection,
} from "@/lib/devices/jobs";
import { addDays } from "@/lib/planning/dates";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { currentThresholds, toAthleteThresholds, type ThresholdRow } from "@/lib/thresholds";
import { localDate } from "@/lib/utils";
import { parseWorkout } from "@/lib/workout/schema";
import { IntervalsApi, IntervalsError, type IntervalsEvent } from "./api";
import { INTERVALS_HISTORY_DAYS, INTERVALS_RECENT_DAYS, normalizeIntervalsActivity, sameActivity } from "./activities";
import { buildIntervalsEvents, intervalsExternalId, INTERVALS_FORMAT_VERSION, INTERVALS_WINDOW_DAYS, type IntervalsBuild } from "./workout";

export interface IntervalsDeps {
  admin: AdminClient;
  api: IntervalsApi;
  key: Buffer;
  now: () => Date;
}

/** La clé ne périme pas : elle reste valable jusqu'à ce que l'athlète la change chez intervals.icu. */
const NEVER = "2100-01-01T00:00:00Z";

const log = (deps: IntervalsDeps, entry: Parameters<typeof deviceLog>[2]) => deviceLog(deps.admin, "intervals", entry);

/** Erreurs d'intervals.icu en issues de la file : quota → report, clé refusée → reconnexion. */
async function translate(deps: IntervalsDeps, connection: DeviceConnection, error: unknown, quiet = false): Promise<unknown> {
  if (!(error instanceof IntervalsError)) return error;
  if (error.kind === "rate_limited") return new DeviceDeferError(error.retryAt ?? new Date(deps.now().getTime() + 15 * 60_000));
  if (error.kind === "unauthorized") {
    await markReauth(deps.admin, "intervals", connection, deps.now(), quiet);
    return new DeviceReauthError("intervals");
  }
  return error;
}

async function apiKey(deps: IntervalsDeps, connection: DeviceConnection, quiet = false): Promise<string> {
  const { data } = await deps.admin.from("oauth_tokens").select("access_token").eq("connection_id", connection.id).maybeSingle();
  if (!data) {
    await markReauth(deps.admin, "intervals", connection, deps.now(), quiet);
    throw new DeviceReauthError("intervals");
  }
  return decryptSecret(data.access_token, deps.key, `${connection.id}:access`);
}

async function withKey<T>(deps: IntervalsDeps, connection: DeviceConnection, call: (key: string) => Promise<T>, quiet = false): Promise<T> {
  const key = await apiKey(deps, connection, quiet);
  try {
    return await call(key);
  } catch (error) {
    throw await translate(deps, connection, error, quiet);
  }
}

// ---------------------------------------------------------------------------
// Connexion et déconnexion
// ---------------------------------------------------------------------------

export type ConnectIntervalsResult = { status: "connected" } | { status: "invalid_key" } | { status: "already_linked" } | { status: "unreachable" };

/** Vérifie la clé chez intervals.icu, la garde chiffrée, puis dépose les séances à venir. */
export async function connectIntervals(deps: IntervalsDeps, athleteId: string, rawKey: string): Promise<ConnectIntervalsResult> {
  const key = rawKey.trim();
  let account: { id: string };
  try {
    account = await deps.api.athlete(key);
  } catch (error) {
    if (error instanceof IntervalsError && (error.kind === "unauthorized" || error.kind === "bad_request")) return { status: "invalid_key" };
    return { status: "unreachable" };
  }

  const { data: taken } = await deps.admin
    .from("external_connections")
    .select("athlete_id")
    .eq("provider", "intervals")
    .eq("external_athlete_id", account.id)
    .maybeSingle();
  if (taken && taken.athlete_id !== athleteId) return { status: "already_linked" };

  const { data: previous } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "intervals")
    .maybeSingle();
  // Autre compte intervals.icu : les séances déposées dans l'ancien en sont retirées (si sa clé vaut encore).
  if (previous && previous.external_athlete_id !== account.id) {
    await removeAll(deps, previous).catch(() => undefined);
    await deps.admin.from("external_connections").delete().eq("id", previous.id);
  }

  const { data: connection, error } = await deps.admin
    .from("external_connections")
    .upsert(
      {
        athlete_id: athleteId,
        provider: "intervals",
        external_athlete_id: account.id,
        scopes: [],
        status: "active",
        connected_at: deps.now().toISOString(),
        last_error: null,
        last_error_at: null,
        sync_lease_until: null,
      },
      { onConflict: "athlete_id,provider" },
    )
    .select("id")
    .single();
  if (error || !connection) throw new Error(`Connexion intervals.icu non enregistrée : ${error?.message ?? "inconnue"}`);
  const { error: keyError } = await deps.admin.from("oauth_tokens").upsert(
    {
      connection_id: connection.id,
      access_token: encryptSecret(key, deps.key, `${connection.id}:access`),
      refresh_token: encryptSecret(key, deps.key, `${connection.id}:refresh`),
      expires_at: NEVER,
      revision: 1,
      updated_at: deps.now().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (keyError) throw new Error(`Enregistrement de la clé impossible : ${keyError.message}`);
  await enqueueDeviceSync(deps.admin, "intervals", athleteId);
  await log(deps, { level: "info", event: "intervals_connected", athleteId });
  return { status: "connected" };
}

/** Retire de l'agenda intervals.icu les séances à venir déposées par TriCoach. */
async function removeAll(deps: IntervalsDeps, connection: DeviceConnection) {
  const today = await todayOf(deps, connection.athlete_id);
  const { data: rows } = await deps.admin.from("device_workouts").select("external_id, scheduled_date, status").eq("connection_id", connection.id);
  const upcoming = (rows ?? []).filter((r) => r.status === "sent" && (!r.scheduled_date || r.scheduled_date >= today)).map((r) => r.external_id);
  await withKey(deps, connection, (key) => deps.api.deleteEvents(key, upcoming), true);
}

/** Retire les séances à venir de l'agenda intervals.icu (s'il répond), puis oublie la clé. */
export async function disconnectIntervals(deps: IntervalsDeps, athleteId: string): Promise<{ removed: boolean }> {
  const { data: connection } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "intervals")
    .maybeSingle();
  if (!connection) return { removed: true };
  const removed = await removeAll(deps, connection).then(
    () => true,
    () => false,
  );
  // Cascade : clé et état des envois.
  await deps.admin.from("external_connections").delete().eq("id", connection.id);
  await deps.admin.from("sync_jobs").delete().eq("athlete_id", athleteId).eq("kind", "intervals_sync").in("status", ["pending", "failed"]);
  await log(deps, { level: "info", event: removed ? "intervals_disconnected" : "intervals_disconnected_events_left", athleteId });
  return { removed };
}

/** Nouvel envoi demandé par l'athlète : les séances refusées sont retentées. */
export async function resendIntervals(deps: IntervalsDeps, athleteId: string): Promise<boolean> {
  const { data: connection } = await deps.admin
    .from("external_connections")
    .select("id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "intervals")
    .maybeSingle();
  if (!connection || connection.status !== "active") return false;
  await deps.admin.from("device_workouts").delete().eq("connection_id", connection.id).eq("status", "failed");
  await enqueueDeviceSync(deps.admin, "intervals", athleteId, `intervals:manual:${athleteId}:${Math.floor(deps.now().getTime() / 60_000)}`);
  return true;
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

interface Desired {
  sessionId: string;
  date: string;
  version: number;
  build: IntervalsBuild;
  hash: string;
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function todayOf(deps: IntervalsDeps, athleteId: string) {
  const { data: profile } = await deps.admin.from("profiles").select("timezone").eq("id", athleteId).maybeSingle();
  return localDate(profile?.timezone ?? "Europe/Paris", deps.now());
}

async function desiredEvents(deps: IntervalsDeps, athleteId: string, today: string): Promise<Map<string, Desired>> {
  const [sessions, thresholds] = await Promise.all([
    deps.admin
      .from("planned_sessions")
      .select("id, scheduled_date, title, description, nutrition_notes, content, version")
      .eq("athlete_id", athleteId)
      .eq("state", "published")
      .gte("scheduled_date", today)
      .lte("scheduled_date", addDays(today, INTERVALS_WINDOW_DAYS - 1))
      .order("scheduled_date"),
    deps.admin.from("athlete_thresholds").select("sport, metric, value, effective_from").eq("athlete_id", athleteId),
  ]);
  if (sessions.error) throw new Error(`Séances illisibles : ${sessions.error.message}`);
  if (thresholds.error) throw new Error(`Seuils illisibles : ${thresholds.error.message}`);

  const desired = new Map<string, Desired>();
  for (const session of sessions.data ?? []) {
    const workout = parseWorkout(session.content);
    const builds: IntervalsBuild[] = workout.success
      ? buildIntervalsEvents(workout.data, {
          sessionId: session.id,
          title: session.title,
          description: session.description,
          nutrition: session.nutrition_notes,
          date: session.scheduled_date,
          thresholds: toAthleteThresholds(currentThresholds((thresholds.data ?? []) as ThresholdRow[], session.scheduled_date)),
        })
      : [
          {
            segmentIndex: 0,
            sport: "other",
            externalId: intervalsExternalId(session.id, 0),
            issues: [{ severity: "blocking", message: "Contenu de la séance invalide : à corriger dans TriCoach." }],
            event: null,
          },
        ];
    for (const build of builds) {
      desired.set(build.externalId, {
        sessionId: session.id,
        date: session.scheduled_date,
        version: session.version,
        build,
        hash: sha256({ format: INTERVALS_FORMAT_VERSION, event: build.event, blocked: build.event ? null : build.issues }),
      });
    }
  }
  return desired;
}

export interface IntervalsSyncReport {
  sent: number;
  deleted: number;
  failed: number;
  /** Activités reçues (nouvelles ou modifiées) et retirées (supprimées chez intervals.icu). */
  activities?: { saved: number; removed: number; fromStrava: number };
}

/** Dépose les séances nouvelles ou modifiées, retire celles qui ne sont plus prévues. */
export async function syncIntervals(deps: IntervalsDeps, connection: DeviceConnection): Promise<IntervalsSyncReport> {
  const report: IntervalsSyncReport = { sent: 0, deleted: 0, failed: 0 };
  // La clé est vérifiée à chaque passage : une clé retirée chez intervals.icu est signalée tout de
  // suite à l'athlète, même quand aucune séance n'a changé.
  await withKey(deps, connection, (key) => deps.api.athlete(key));
  const today = await todayOf(deps, connection.athlete_id);
  const desired = await desiredEvents(deps, connection.athlete_id, today);
  const { data: rows, error } = await deps.admin
    .from("device_workouts")
    .select("id, external_id, remote_id, content_hash, status, scheduled_date")
    .eq("connection_id", connection.id);
  if (error) throw new Error(`État des envois illisible : ${error.message}`);
  const rowsByExternal = new Map((rows ?? []).map((r) => [r.external_id, r]));

  const save = async (externalId: string, d: Desired, values: { status: "sent" | "failed"; remote_id: string | null; last_error: string | null }) => {
    const { error: saveError } = await deps.admin.from("device_workouts").upsert(
      {
        connection_id: connection.id,
        provider: "intervals",
        athlete_id: connection.athlete_id,
        session_id: d.sessionId,
        segment_index: d.build.segmentIndex,
        external_id: externalId,
        session_version: d.version,
        content_hash: d.hash,
        scheduled_date: d.date,
        issues: d.build.issues as unknown as NonNullable<Json>,
        sent_at: values.status === "sent" ? deps.now().toISOString() : null,
        ...values,
      },
      { onConflict: "connection_id,external_id" },
    );
    if (saveError) throw new Error(`État de l'envoi non enregistré : ${saveError.message}`);
  };

  // Séances impossibles à transmettre : la raison est gardée, et l'ancienne version est retirée.
  const toRemove: string[] = [];
  const toSend: [string, Desired][] = [];
  for (const [externalId, d] of desired) {
    const row = rowsByExternal.get(externalId);
    if (!d.build.event) {
      if (row?.status === "sent") toRemove.push(externalId);
      if (!(row?.status === "failed" && row.content_hash === d.hash)) {
        const blocking = d.build.issues.find((i) => i.severity === "blocking");
        await save(externalId, d, { status: "failed", remote_id: null, last_error: (blocking?.message ?? "Séance impossible à transmettre.").slice(0, 300) });
      }
      report.failed += 1;
      continue;
    }
    // Déjà déposée telle quelle, ou déjà refusée telle quelle : rien à refaire.
    if (row?.content_hash === d.hash && (row.status === "sent" || row.status === "failed")) {
      if (row.status === "failed") report.failed += 1;
      continue;
    }
    toSend.push([externalId, d]);
  }

  if (toSend.length) {
    const events = toSend.map(([, d]) => d.build.event as IntervalsEvent);
    try {
      const ids = await withKey(deps, connection, (key) => deps.api.upsertEvents(key, events));
      for (const [externalId, d] of toSend) {
        const id = ids.get(externalId);
        if (id) {
          await save(externalId, d, { status: "sent", remote_id: id, last_error: null });
          report.sent += 1;
        } else {
          await save(externalId, d, { status: "failed", remote_id: null, last_error: "intervals.icu n'a pas confirmé cette séance." });
          report.failed += 1;
        }
      }
    } catch (failure) {
      if (!(failure instanceof IntervalsError && failure.kind === "bad_request")) throw failure;
      // Lot refusé : chaque séance est redéposée seule, pour isoler celle qui pose problème.
      for (const [externalId, d] of toSend) {
        try {
          const ids = await withKey(deps, connection, (key) => deps.api.upsertEvents(key, [d.build.event as IntervalsEvent]));
          const id = ids.get(externalId);
          if (!id) throw new IntervalsError("invalid_response", "Séance non confirmée.");
          await save(externalId, d, { status: "sent", remote_id: id, last_error: null });
          report.sent += 1;
        } catch (error) {
          if (!(error instanceof IntervalsError && (error.kind === "bad_request" || error.kind === "invalid_response"))) throw error;
          await save(externalId, d, { status: "failed", remote_id: null, last_error: "intervals.icu a refusé cette séance : elle est à revoir dans TriCoach." });
          await log(deps, { level: "warn", event: "intervals_event_refused", message: error.detail?.slice(0, 300), athleteId: connection.athlete_id });
          report.failed += 1;
        }
      }
    }
  }

  // Retraits : séances annulées, supprimées, repassées en brouillon ou déplacées hors de la fenêtre.
  // Les séances passées restent dans l'agenda intervals.icu (historique) ; TriCoach cesse de les suivre.
  const stale = (rows ?? []).filter((r) => !desired.has(r.external_id));
  for (const row of stale) if (row.status === "sent" && (!row.scheduled_date || row.scheduled_date >= today)) toRemove.push(row.external_id);
  if (toRemove.length) {
    await withKey(deps, connection, (key) => deps.api.deleteEvents(key, toRemove));
    report.deleted += toRemove.length;
  }
  if (stale.length) await deps.admin.from("device_workouts").delete().in("id", stale.map((r) => r.id));

  report.activities = await pullActivities(deps, connection, today);

  await deps.admin.from("external_connections").update({ last_sync_at: deps.now().toISOString(), last_error: null, last_error_at: null }).eq("id", connection.id);
  return report;
}

const ACTIVITY_SELECT =
  "id, external_id, sport, sport_detail, name, start_time, local_date, local_start_time, timezone, elapsed_s, moving_s, distance_m, elevation_gain_m, avg_hr, max_hr, avg_power, weighted_power, max_power, avg_cadence, avg_speed_mps, trainer, manual, device_name";

/**
 * Activités faites : 90 jours à la première réception, puis les 14 derniers jours à chaque passage.
 * Seules les activités nouvelles ou modifiées sont écrites (chaque écriture relance le rapprochement).
 */
async function pullActivities(deps: IntervalsDeps, connection: DeviceConnection, today: string) {
  const { data: state } = await deps.admin
    .from("external_connections")
    .select("activities_synced_at")
    .eq("id", connection.id)
    .maybeSingle();
  const { data: profile } = await deps.admin.from("profiles").select("timezone").eq("id", connection.athlete_id).maybeSingle();
  const timeZone = profile?.timezone ?? "Europe/Paris";
  const oldest = addDays(today, -(state?.activities_synced_at ? INTERVALS_RECENT_DAYS : INTERVALS_HISTORY_DAYS));
  const newest = addDays(today, 1);

  const listed = await withKey(deps, connection, (key) => deps.api.activities(key, oldest, newest));
  let fromStrava = 0;
  const upstream = new Map<string, ReturnType<typeof normalizeIntervalsActivity> & { kind: "activity" }>();
  for (const raw of listed) {
    const outcome = normalizeIntervalsActivity(raw, timeZone);
    if (outcome.kind === "strava") fromStrava += 1;
    if (outcome.kind === "activity" && outcome.fields.local_date >= oldest && outcome.fields.local_date <= newest) upstream.set(outcome.fields.external_id, outcome);
  }

  const { data: stored, error } = await deps.admin
    .from("activities")
    .select(ACTIVITY_SELECT)
    .eq("athlete_id", connection.athlete_id)
    .eq("source", "intervals")
    .gte("local_date", oldest)
    .lte("local_date", newest);
  if (error) throw new Error(`Activités reçues illisibles : ${error.message}`);
  const storedByExternal = new Map((stored ?? []).map((row) => [row.external_id, row]));

  const changed = [...upstream.values()]
    .filter(({ fields }) => {
      const row = storedByExternal.get(fields.external_id);
      return !row || !sameActivity(row as unknown as Record<string, unknown>, fields);
    })
    .map(({ fields }) => ({ ...fields, athlete_id: connection.athlete_id, source: "intervals" as const, fetched_at: deps.now().toISOString() }));
  for (let i = 0; i < changed.length; i += 50) {
    const { error: saveError } = await deps.admin.from("activities").upsert(changed.slice(i, i + 50), { onConflict: "athlete_id,source,external_id" });
    if (saveError) throw new Error(`Activités non enregistrées : ${saveError.message}`);
  }
  const gone = (stored ?? []).filter((row) => !upstream.has(row.external_id)).map((row) => row.id);
  if (gone.length) {
    const { error: removeError } = await deps.admin.from("activities").delete().in("id", gone);
    if (removeError) throw new Error(`Activités retirées non effacées : ${removeError.message}`);
  }
  await deps.admin
    .from("external_connections")
    .update({ activities_synced_at: deps.now().toISOString(), activities_skipped: fromStrava })
    .eq("id", connection.id);
  if (changed.length || gone.length) {
    await log(deps, { level: "info", event: "intervals_activities", message: `${changed.length} reçue(s), ${gone.length} retirée(s)`, athleteId: connection.athlete_id });
  }
  return { saved: changed.length, removed: gone.length, fromStrava };
}

/** Exécute les dépôts dus (un seul à la fois par compte), dans le temps imparti. */
export const runIntervalsJobs = (deps: IntervalsDeps, options: { limit?: number; budgetMs?: number } = {}) =>
  runDeviceJobs(deps, "intervals", (connection) => syncIntervals(deps, connection), options);

/** Tâche quotidienne : la fenêtre de 14 jours avance d'un jour. */
export const enqueueDailyIntervals = (deps: IntervalsDeps) => enqueueDailyDevice(deps, "intervals");
