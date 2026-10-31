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
import { missingColumn } from "@/lib/supabase/schema";
import { computeTotals } from "@/lib/workout/compute";
import { parseWorkout } from "@/lib/workout/schema";
import { IntervalsApi, IntervalsError, type IntervalsAuth, type IntervalsEvent } from "./api";
import { alignmentUpdates, appliedAsSent, compareThresholds, type SyncedThresholdKey, type ThresholdComparison } from "./thresholds";
import { detailsUpToDate, INTERVALS_STREAM_TYPES, intervalsLaps, intervalsStreams, powerBests, reduceStreams, streamMetrics } from "@/lib/activities/streams";
import { INTERVALS_FULL_HISTORY_DAYS, INTERVALS_HISTORY_DAYS, INTERVALS_RECENT_DAYS, normalizeIntervalsActivity, sameActivity } from "./activities";
import { normalizePlannedEvent, PLANNED_FUTURE_DAYS, PLANNED_PAST_DAYS, type PlannedFields } from "./planned";
import { missingMeasures, morningMeasures, WELLNESS_RECENT_DAYS, type MorningMeasures } from "./wellness";
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

/**
 * Accès au compte : la clé API collée par l'athlète, ou le jeton reçu quand il a autorisé TriCoach
 * (connexion par « Autoriser », reconnue aux autorisations enregistrées).
 */
async function apiKey(deps: IntervalsDeps, connection: DeviceConnection, quiet = false): Promise<IntervalsAuth> {
  const [{ data }, { data: link }] = await Promise.all([
    deps.admin.from("oauth_tokens").select("access_token").eq("connection_id", connection.id).maybeSingle(),
    deps.admin.from("external_connections").select("scopes").eq("id", connection.id).maybeSingle(),
  ]);
  if (!data) {
    await markReauth(deps.admin, "intervals", connection, deps.now(), quiet);
    throw new DeviceReauthError("intervals");
  }
  const secret = decryptSecret(data.access_token, deps.key, `${connection.id}:access`);
  return link?.scopes?.length ? { bearer: secret } : secret;
}

async function withKey<T>(deps: IntervalsDeps, connection: DeviceConnection, call: (key: IntervalsAuth) => Promise<T>, quiet = false): Promise<T> {
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
  return saveConnection(deps, athleteId, account.id, key, []);
}

export type ConnectIntervalsOAuthResult = ConnectIntervalsResult | { status: "denied" };

/**
 * Retour de « Autoriser » chez intervals.icu : le code est échangé contre le jeton de l'athlète
 * (dans les 2 minutes), gardé chiffré comme une clé, avec les autorisations accordées.
 */
export async function connectIntervalsOAuth(
  deps: IntervalsDeps,
  athleteId: string,
  input: { code: string; verifier: string; clientId: string; clientSecret: string },
): Promise<ConnectIntervalsOAuthResult> {
  let granted: Awaited<ReturnType<IntervalsApi["oauthToken"]>>;
  try {
    granted = await deps.api.oauthToken(input);
  } catch (error) {
    if (error instanceof IntervalsError && error.kind === "unauthorized") return { status: "denied" };
    return { status: "unreachable" };
  }
  const scopes = granted.scope
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  // Jeton sans autorisation lisible : on garde au moins une marque, pour l'envoyer en « Bearer ».
  return saveConnection(deps, athleteId, granted.athlete.id, granted.token, scopes.length ? scopes : ["oauth"]);
}

/** Enregistre le compte relié (clé API : sans autorisation ; « Autoriser » : avec), puis lance l'envoi. */
async function saveConnection(deps: IntervalsDeps, athleteId: string, accountId: string, secret: string, scopes: string[]): Promise<ConnectIntervalsResult> {
  const { data: taken } = await deps.admin
    .from("external_connections")
    .select("athlete_id")
    .eq("provider", "intervals")
    .eq("external_athlete_id", accountId)
    .maybeSingle();
  if (taken && taken.athlete_id !== athleteId) return { status: "already_linked" };

  const { data: previous } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "intervals")
    .maybeSingle();
  // Autre compte intervals.icu : les séances déposées dans l'ancien en sont retirées (si sa clé vaut encore).
  if (previous && previous.external_athlete_id !== accountId) {
    await removeAll(deps, previous).catch(() => undefined);
    await deps.admin.from("external_connections").delete().eq("id", previous.id);
  }

  const { data: connection, error } = await deps.admin
    .from("external_connections")
    .upsert(
      {
        athlete_id: athleteId,
        provider: "intervals",
        external_athlete_id: accountId,
        scopes,
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
      access_token: encryptSecret(secret, deps.key, `${connection.id}:access`),
      refresh_token: encryptSecret(secret, deps.key, `${connection.id}:refresh`),
      expires_at: NEVER,
      revision: 1,
      updated_at: deps.now().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (keyError) throw new Error(`Enregistrement de la clé impossible : ${keyError.message}`);
  await enqueueDeviceSync(deps.admin, "intervals", athleteId);
  await log(deps, { level: "info", event: scopes.length ? "intervals_authorized" : "intervals_connected", athleteId });
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
  // Connexion par « Autoriser » : l'autorisation est aussi retirée chez intervals.icu (si elle vaut encore).
  await withKey(deps, connection, async (auth) => (typeof auth === "string" ? undefined : deps.api.disconnectApp(auth)), true).catch(() => undefined);
  // Cascade : clé et état des envois.
  await deps.admin.from("external_connections").delete().eq("id", connection.id);
  // Séances reprises de son calendrier : celles à venir ne sont plus suivies, elles partent ; les passées
  // restent (prévu contre réalisé). Base pas encore à jour : rien à retirer.
  const { error: plannedError } = await deps.admin
    .from("planned_sessions")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("source", "intervals")
    .gte("scheduled_date", await todayOf(deps, athleteId));
  if (plannedError && !missingColumn(plannedError)) throw new Error(`Séances reprises non retirées : ${plannedError.message}`);
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
// Seuils : TriCoach fait référence, intervals.icu s'aligne d'un geste
// ---------------------------------------------------------------------------

export type IntervalsThresholdsResult =
  | { status: "ok"; rows: ThresholdComparison[]; aligned?: number; failed?: number }
  | { status: "not_linked" }
  | { status: "reauth" }
  | { status: "unreachable" };

async function intervalsConnection(deps: IntervalsDeps, athleteId: string) {
  const { data } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "intervals")
    .maybeSingle();
  return data;
}

/** Seuils en vigueur aujourd'hui dans TriCoach, pour ceux qu'intervals.icu connaît aussi. */
async function syncedThresholds(deps: IntervalsDeps, athleteId: string): Promise<Partial<Record<SyncedThresholdKey, number>>> {
  const [today, { data, error }] = await Promise.all([
    todayOf(deps, athleteId),
    deps.admin.from("athlete_thresholds").select("sport, metric, value, effective_from").eq("athlete_id", athleteId),
  ]);
  if (error) throw new Error(`Seuils illisibles : ${error.message}`);
  const current = currentThresholds((data ?? []) as ThresholdRow[], today);
  return Object.fromEntries([...current].map(([key, row]) => [key, Number(row.value)]));
}

/** Les erreurs d'intervals.icu deviennent un état à afficher ; les autres remontent. */
function thresholdsFailure(error: unknown): IntervalsThresholdsResult {
  if (error instanceof DeviceReauthError) return { status: "reauth" };
  if (error instanceof DeviceDeferError || error instanceof IntervalsError) return { status: "unreachable" };
  throw error;
}

/** Seuils de TriCoach et d'intervals.icu côte à côte (lecture seule chez intervals.icu). */
export async function compareIntervalsThresholds(deps: IntervalsDeps, athleteId: string): Promise<IntervalsThresholdsResult> {
  const connection = await intervalsConnection(deps, athleteId);
  if (!connection) return { status: "not_linked" };
  if (connection.status !== "active") return { status: "reauth" };
  try {
    const [current, settings] = await Promise.all([syncedThresholds(deps, athleteId), withKey(deps, connection, (key) => deps.api.sportSettings(key))]);
    return { status: "ok", rows: compareThresholds(current, settings.map((s) => s.settings)) };
  } catch (error) {
    return thresholdsFailure(error);
  }
}

/**
 * Aligne intervals.icu sur TriCoach : seuls les seuils différents partent (FTP, FC seuil, FC max,
 * allure seuil, CSS), relus dans la réponse ; rien n'est effacé chez intervals.icu. Si intervals.icu
 * remplaçait tout le réglage au lieu des seuls champs envoyés (types d'activité perdus), le réglage
 * complet lu juste avant est renvoyé avec les nouvelles valeurs : rien n'est perdu.
 */
export async function alignIntervalsThresholds(deps: IntervalsDeps, athleteId: string): Promise<IntervalsThresholdsResult> {
  const connection = await intervalsConnection(deps, athleteId);
  if (!connection) return { status: "not_linked" };
  if (connection.status !== "active") return { status: "reauth" };
  try {
    const current = await syncedThresholds(deps, athleteId);
    return await withKey(
      deps,
      connection,
      async (key) => {
        const before = await deps.api.sportSettings(key);
        const updates = alignmentUpdates(compareThresholds(current, before.map((s) => s.settings)));
        let aligned = 0;
        let failed = 0;
        for (const update of updates) {
          const previous = before.find((s) => s.settings.id === update.settingsId)!;
          try {
            let after = await deps.api.updateSportSettings(key, update.settingsId, { ...update.patch }, update.recalcHrZones);
            if (previous.settings.types.length && !after.settings.types.length) {
              after = await deps.api.updateSportSettings(key, update.settingsId, { ...previous.raw, ...update.patch }, update.recalcHrZones);
            }
            if (appliedAsSent(update, after.settings)) aligned += update.rows.length;
            else failed += update.rows.length;
          } catch (error) {
            if (error instanceof IntervalsError && (error.kind === "unauthorized" || error.kind === "rate_limited")) throw error;
            failed += update.rows.length;
          }
        }
        await log(deps, { level: failed ? "warn" : "info", event: failed ? "intervals_thresholds_partly_aligned" : "intervals_thresholds_aligned", athleteId, message: `${aligned} aligné(s), ${failed} en échec` });
        const settings = updates.length ? await deps.api.sportSettings(key) : before;
        return { status: "ok" as const, rows: compareThresholds(current, settings.map((s) => s.settings)), aligned, failed };
      },
    );
  } catch (error) {
    return thresholdsFailure(error);
  }
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
  // Seulement les séances de TriCoach : celles reprises d'intervals.icu y sont déjà.
  const published = (onlyOwn: boolean) => {
    const query = deps.admin
      .from("planned_sessions")
      .select("id, scheduled_date, title, description, nutrition_notes, content, version")
      .eq("athlete_id", athleteId)
      .eq("state", "published")
      .gte("scheduled_date", today)
      .lte("scheduled_date", addDays(today, INTERVALS_WINDOW_DAYS - 1));
    return (onlyOwn ? query.eq("source", "tricoach") : query).order("scheduled_date");
  };
  const [own, thresholds] = await Promise.all([
    published(true),
    deps.admin.from("athlete_thresholds").select("sport, metric, value, effective_from").eq("athlete_id", athleteId),
  ]);
  // Base pas encore à jour (pas de séances reprises d'intervals.icu) : toutes sont de TriCoach.
  const sessions = own.error && missingColumn(own.error) ? await published(false) : own;
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
  /** Jours de forme complétés par les mesures du matin. */
  wellness?: number;
  /** Activités dont les courbes ont été lues. */
  streams?: number;
  /** Séances prévues dans intervals.icu, reprises (nouvelles ou modifiées) et retirées. */
  planned?: { saved: number; removed: number };
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
  report.planned = await pullPlannedWorkouts(deps, connection, today);
  report.wellness = await pullMorningMeasures(deps, connection, today);
  report.streams = await pullStreams(deps, connection, today);

  await deps.admin.from("external_connections").update({ last_sync_at: deps.now().toISOString(), last_error: null, last_error_at: null }).eq("id", connection.id);
  return report;
}

/**
 * Mesures du matin (FC au repos, VFC, sommeil, poids) des 14 derniers jours : elles complètent la
 * forme du jour sans jamais remplacer une valeur saisie par l'athlète.
 */
/** Mesures du matin reçues sur un an, une fois : les tendances (VFC, FC au repos, sommeil) en ont besoin. */
export const WELLNESS_HISTORY_DAYS = 365;

/**
 * Mesures du matin : un an à la première réception (une fois), puis les 14 derniers jours. Seules
 * les mesures absentes ou changées sont écrites ; une saisie de l'athlète n'est jamais écrasée.
 */
async function pullMorningMeasures(deps: IntervalsDeps, connection: DeviceConnection, today: string): Promise<number> {
  // Base pas encore à jour (sans la date de l'historique) : les 14 derniers jours seulement.
  const state = await deps.admin.from("external_connections").select("wellness_from").eq("id", connection.id).maybeSingle();
  const upToDate = !missingColumn(state.error);
  if (state.error && upToDate) throw new Error(`État de la réception illisible : ${state.error.message}`);
  const needsHistory = upToDate && !state.data?.wellness_from;
  const oldest = addDays(today, needsHistory ? -(WELLNESS_HISTORY_DAYS - 1) : -(WELLNESS_RECENT_DAYS - 1));
  const listed = await withKey(deps, connection, (key) => deps.api.wellness(key, oldest, today));
  const upstream = morningMeasures(listed).filter((m) => m.entry_date >= oldest && m.entry_date <= today);
  const { data: stored, error } = await deps.admin
    .from("wellness_entries")
    .select("entry_date, resting_hr, hrv_ms, sleep_hours, weight_kg")
    .eq("athlete_id", connection.athlete_id)
    .gte("entry_date", oldest)
    .lte("entry_date", today);
  if (error) throw new Error(`Forme du jour illisible : ${error.message}`);
  const byDate = new Map((stored ?? []).map((row) => [row.entry_date, row]));
  let written = 0;
  const inserts: ({ athlete_id: string; entry_date: string } & Partial<MorningMeasures>)[] = [];
  for (const measures of upstream) {
    const row = byDate.get(measures.entry_date);
    const changes = missingMeasures(measures, row);
    if (!changes) continue;
    if (!row) {
      inserts.push({ athlete_id: connection.athlete_id, entry_date: measures.entry_date, ...changes });
      continue;
    }
    const { error: saveError } = await deps.admin.from("wellness_entries").update(changes).eq("athlete_id", connection.athlete_id).eq("entry_date", measures.entry_date);
    if (saveError) throw new Error(`Forme du jour non enregistrée : ${saveError.message}`);
    written += 1;
  }
  // Jours nouveaux : en lots (une année d'historique en quelques écritures).
  for (let i = 0; i < inserts.length; i += 200) {
    const { error: saveError } = await deps.admin.from("wellness_entries").insert(inserts.slice(i, i + 200));
    if (saveError) throw new Error(`Forme du jour non enregistrée : ${saveError.message}`);
    written += Math.min(200, inserts.length - i);
  }
  if (needsHistory) {
    const { error: markError } = await deps.admin.from("external_connections").update({ wellness_from: oldest }).eq("id", connection.id);
    if (markError) throw new Error(`État de la réception non enregistré : ${markError.message}`);
  }
  return written;
}

/** Même contenu JSON, quel que soit l'ordre des clés (la base range les clés à sa façon). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
    const right = Object.entries(b as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
    return left.length === right.length && left.every(([key, value]) => sameJson(value, (b as Record<string, unknown>)[key]));
  }
  return false;
}

const PLANNED_SELECT = "id, external_id, external_updated_at, scheduled_date, start_time, sport, title, description, content, planned_duration_s, planned_distance_m, import_notes";

/**
 * Séances prévues dans le calendrier intervals.icu (par le coach de l'athlète, ou par lui-même) :
 * reprises en lecture seule, sur les 8 dernières et les 8 prochaines semaines. Une séance modifiée
 * chez intervals.icu l'est ici, une séance retirée là-bas l'est aussi ; seules les séances nouvelles
 * ou changées sont écrites (chaque écriture relance le rapprochement avec les activités).
 */
async function pullPlannedWorkouts(deps: IntervalsDeps, connection: DeviceConnection, today: string): Promise<{ saved: number; removed: number }> {
  const oldest = addDays(today, -PLANNED_PAST_DAYS);
  const newest = addDays(today, PLANNED_FUTURE_DAYS);
  const [stored, thresholds] = await Promise.all([
    deps.admin
      .from("planned_sessions")
      .select(PLANNED_SELECT)
      .eq("athlete_id", connection.athlete_id)
      .eq("source", "intervals")
      .gte("scheduled_date", oldest)
      .lte("scheduled_date", newest),
    deps.admin.from("athlete_thresholds").select("sport, metric, value, effective_from").eq("athlete_id", connection.athlete_id),
  ]);
  // Base pas encore à jour : rien à reprendre pour l'instant.
  if (stored.error && missingColumn(stored.error)) return { saved: 0, removed: 0 };
  if (stored.error) throw new Error(`Séances reprises illisibles : ${stored.error.message}`);
  if (thresholds.error) throw new Error(`Seuils illisibles : ${thresholds.error.message}`);

  const listed = await withKey(deps, connection, (key) => deps.api.plannedWorkouts(key, oldest, newest));
  const upstream = new Map<string, PlannedFields>();
  for (const raw of listed) {
    const outcome = normalizePlannedEvent(raw);
    if (outcome.kind === "workout" && outcome.fields.scheduled_date >= oldest && outcome.fields.scheduled_date <= newest) upstream.set(outcome.fields.external_id, outcome.fields);
  }

  const rows = stored.data ?? [];
  const storedByExternal = new Map(rows.map((row) => [row.external_id as string, row]));
  const keep = (status: string) => status === "exact" || status === "estimated";
  let saved = 0;
  for (const fields of upstream.values()) {
    // Durée et distance calculées par TriCoach avec les seuils de la date ; sinon celles d'intervals.icu.
    const totals = computeTotals(fields.content, toAthleteThresholds(currentThresholds((thresholds.data ?? []) as ThresholdRow[], fields.scheduled_date)));
    const values = {
      external_updated_at: fields.external_updated_at,
      scheduled_date: fields.scheduled_date,
      start_time: fields.start_time,
      sport: fields.sport,
      title: fields.title,
      description: fields.description,
      content: fields.content as unknown as NonNullable<Json>,
      planned_duration_s: keep(totals.duration.status) && totals.duration.value > 0 ? Math.round(totals.duration.value) : fields.moving_s,
      planned_distance_m: keep(totals.distance.status) && totals.distance.value > 0 ? Math.round(totals.distance.value * 10) / 10 : fields.distance_m,
      import_notes: fields.import_notes.length ? fields.import_notes : null,
    };
    const row = storedByExternal.get(fields.external_id);
    if (!row) {
      const { error } = await deps.admin
        .from("planned_sessions")
        .insert({ ...values, athlete_id: connection.athlete_id, source: "intervals", external_id: fields.external_id, state: "published" });
      // Reprise en même temps par une autre réception : déjà là.
      if (error && error.code !== "23505") throw new Error(`Séance d'intervals.icu non enregistrée : ${error.message}`);
      if (!error) saved += 1;
      continue;
    }
    const same =
      row.scheduled_date === values.scheduled_date &&
      (row.start_time ?? null)?.slice(0, 8) === (values.start_time ?? null)?.slice(0, 8) &&
      row.sport === values.sport &&
      row.title === values.title &&
      (row.description ?? null) === values.description &&
      (row.planned_duration_s ?? null) === (values.planned_duration_s ?? null) &&
      (row.planned_distance_m === null ? null : Number(row.planned_distance_m)) === (values.planned_distance_m ?? null) &&
      sameJson(row.import_notes ?? null, values.import_notes) &&
      (row.external_updated_at === null ? null : Date.parse(row.external_updated_at)) === (values.external_updated_at === null ? null : Date.parse(values.external_updated_at)) &&
      sameJson(row.content, fields.content);
    if (same) continue;
    const { error } = await deps.admin.from("planned_sessions").update(values).eq("id", row.id);
    if (error) throw new Error(`Séance d'intervals.icu non mise à jour : ${error.message}`);
    saved += 1;
  }
  const gone = rows.filter((row) => !upstream.has(row.external_id as string)).map((row) => row.id);
  if (gone.length) {
    const { error } = await deps.admin.from("planned_sessions").delete().in("id", gone);
    if (error) throw new Error(`Séances retirées d'intervals.icu non effacées : ${error.message}`);
  }
  if (saved || gone.length) {
    await log(deps, { level: "info", event: "intervals_planned", message: `${saved} séance(s) prévue(s) reprise(s), ${gone.length} retirée(s)`, athleteId: connection.athlete_id });
  }
  return { saved, removed: gone.length };
}

const ACTIVITY_SELECT =
  "id, external_id, sport, sport_detail, name, start_time, local_date, local_start_time, timezone, elapsed_s, moving_s, distance_m, elevation_gain_m, avg_hr, max_hr, avg_power, weighted_power, max_power, avg_cadence, avg_speed_mps, trainer, manual, device_name";

/**
 * Activités faites : un an à la première réception (une fois aussi pour une connexion plus ancienne),
 * puis les 14 derniers jours à chaque passage, avec la charge calculée par intervals.icu.
 * Seules les activités nouvelles ou modifiées sont écrites (chaque écriture relance le rapprochement).
 */
async function pullActivities(deps: IntervalsDeps, connection: DeviceConnection, today: string) {
  // Base pas encore à jour (sans charge reçue ni historique d'un an) : la réception d'avant.
  const withHistory = await deps.admin.from("external_connections").select("activities_synced_at, history_from").eq("id", connection.id).maybeSingle();
  const upToDate = !missingColumn(withHistory.error);
  if (withHistory.error && upToDate) throw new Error(`État de la réception illisible : ${withHistory.error.message}`);
  const state = upToDate
    ? withHistory.data
    : ((await deps.admin.from("external_connections").select("activities_synced_at").eq("id", connection.id).maybeSingle()).data as { activities_synced_at: string | null; history_from?: string | null } | null);
  const { data: profile } = await deps.admin.from("profiles").select("timezone").eq("id", connection.athlete_id).maybeSingle();
  const timeZone = profile?.timezone ?? "Europe/Paris";
  // Un an d'historique, reçu une fois (aussi pour une connexion plus ancienne), puis les 14 derniers jours.
  const yearAgo = addDays(today, -INTERVALS_FULL_HISTORY_DAYS);
  const needsHistory = upToDate ? !state?.history_from || state.history_from > yearAgo : !state?.activities_synced_at;
  const oldest = needsHistory ? (upToDate ? yearAgo : addDays(today, -INTERVALS_HISTORY_DAYS)) : addDays(today, -INTERVALS_RECENT_DAYS);
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
    .select(upToDate ? `${ACTIVITY_SELECT}, source_load` : ACTIVITY_SELECT)
    .eq("athlete_id", connection.athlete_id)
    .eq("source", "intervals")
    .gte("local_date", oldest)
    .lte("local_date", newest)
    .limit(2000);
  if (error) throw new Error(`Activités reçues illisibles : ${error.message}`);
  const rows = (stored ?? []) as unknown as (Record<string, unknown> & { id: string; external_id: string; source_load?: number | string | null })[];
  const storedByExternal = new Map(rows.map((row) => [row.external_id, row]));
  const sameLoad = (a: number | string | null | undefined, b: number | null) => (a === null || a === undefined ? b === null : b !== null && Math.abs(Number(a) - b) < 0.05);

  // Contenu changé (ses courbes sont relues), ou seulement la charge calculée par intervals.icu.
  const contentChanged = new Set<string>();
  const changed = [...upstream.values()]
    .filter(({ fields, sourceLoad }) => {
      const row = storedByExternal.get(fields.external_id);
      if (!row || !sameActivity(row, fields)) {
        contentChanged.add(fields.external_id);
        return true;
      }
      return upToDate && !sameLoad(row.source_load, sourceLoad);
    })
    .map(({ fields, sourceLoad }) => ({
      ...fields,
      ...(upToDate ? { source_load: sourceLoad } : {}),
      athlete_id: connection.athlete_id,
      source: "intervals" as const,
      fetched_at: deps.now().toISOString(),
    }));
  for (let i = 0; i < changed.length; i += 50) {
    const { error: saveError } = await deps.admin.from("activities").upsert(changed.slice(i, i + 50), { onConflict: "athlete_id,source,external_id" });
    if (saveError) throw new Error(`Activités non enregistrées : ${saveError.message}`);
  }
  // Activité modifiée chez intervals.icu (souvent : analyse terminée) : ses courbes sont relues.
  const updated = changed
    .filter((a) => contentChanged.has(a.external_id))
    .map((a) => storedByExternal.get(a.external_id)?.id)
    .filter((id): id is string => Boolean(id));
  if (updated.length) await deps.admin.from("activity_streams").delete().in("activity_id", updated);
  const gone = rows.filter((row) => !upstream.has(row.external_id)).map((row) => row.id);
  if (gone.length) {
    const { error: removeError } = await deps.admin.from("activities").delete().in("id", gone);
    if (removeError) throw new Error(`Activités retirées non effacées : ${removeError.message}`);
  }
  await deps.admin
    .from("external_connections")
    .update({
      activities_synced_at: deps.now().toISOString(),
      activities_skipped: fromStrava,
      ...(upToDate && needsHistory ? { history_from: oldest } : {}),
    })
    .eq("id", connection.id);
  if (changed.length || gone.length) {
    await log(deps, { level: "info", event: "intervals_activities", message: `${changed.length} reçue(s), ${gone.length} retirée(s)`, athleteId: connection.athlete_id });
  }
  return { saved: changed.length, removed: gone.length, fromStrava };
}

/** Détails lus au plus par synchronisation (deux appels chacun) ; le reste par la lecture de rattrapage. */
export const STREAMS_PER_RUN = 40;
const STREAMS_BUDGET_MS = 15_000;
/** Détails lus sur un an : les records de la saison et la FTP estimée en dépendent. */
export const STREAMS_HISTORY_DAYS = INTERVALS_FULL_HISTORY_DAYS;
/**
 * Activités lues en même temps (deux appels chacune, l'un après l'autre) : bien en dessous de la
 * limite d'intervals.icu (10 appels par seconde).
 */
export const DETAILS_PARALLEL = 2;
/** Activités récentes, lues avant tout le reste : celle qu'on vient de faire a ses détails tout de suite. */
const DETAILS_RECENT_DAYS = 14;

export interface DetailsProgress {
  /** Activités dont les détails ont été lus pendant cet appel. */
  read: number;
  /** Activités de l'année qui attendent encore leurs détails. */
  remaining: number;
  /** Activités reçues d'intervals.icu sur l'année (doublons exclus). */
  total: number;
  /** Lecture interrompue (quota, panne passagère) : reprise plus tard. */
  paused: boolean;
}

type BacklogRow = { id: string; external_id: string; sport: string; local_date: string };

/**
 * Activités de l'année sans détails à jour (jamais lus, ou lus avec un calcul plus ancien), dans
 * l'ordre de lecture : les 14 derniers jours, puis le vélo, puis la course et la natation, puis le
 * reste ; chaque groupe de la plus récente à la plus ancienne. Les doublons ne sont pas lus.
 */
async function detailsBacklog(deps: IntervalsDeps, athleteId: string, today: string): Promise<{ total: number; missing: BacklogRow[] }> {
  const { data: rows, error } = await deps.admin
    .from("activities")
    .select("id, external_id, sport, local_date, stored:activity_streams(version:metrics->v)")
    .eq("athlete_id", athleteId)
    .eq("source", "intervals")
    .is("duplicate_of", null)
    .gte("local_date", addDays(today, -STREAMS_HISTORY_DAYS))
    .order("start_time", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Activités reçues illisibles : ${error.message}`);
  const recent = addDays(today, -DETAILS_RECENT_DAYS);
  const rank = (row: BacklogRow) => (row.local_date >= recent ? 0 : row.sport === "bike" ? 1 : row.sport === "run" || row.sport === "swim" ? 2 : 3);
  const missing = (rows ?? [])
    .filter((row) => {
      const stored = (Array.isArray(row.stored) ? row.stored[0] : row.stored) as { version?: unknown } | null | undefined;
      return !detailsUpToDate(stored?.version);
    })
    .map(({ id, external_id, sport, local_date }) => ({ id, external_id, sport, local_date }))
    // Tri stable : l'ordre chronologique inverse est gardé dans chaque groupe.
    .sort((a, b) => rank(a) - rank(b));
  return { total: rows?.length ?? 0, missing };
}

/**
 * Détails d'une activité (courbes, intervalles détectés, records), lus chez intervals.icu.
 * Une activité sans courbe (saisie à la main, introuvable) est notée vide, pour ne pas être relue.
 * « stop » : quota, clé ou panne passagère, la lecture reprend plus tard.
 */
async function readActivityDetails(deps: IntervalsDeps, key: IntervalsAuth, activity: BacklogRow): Promise<"read" | "stop"> {
  let streamsBody: unknown;
  let lapsBody: unknown = null;
  try {
    streamsBody = await deps.api.streams(key, activity.external_id, Object.keys(INTERVALS_STREAM_TYPES));
    lapsBody = await deps.api.intervals(key, activity.external_id).catch((failure) => {
      // Intervalles indisponibles : les courbes restent utiles sans eux.
      if (failure instanceof IntervalsError && (failure.kind === "bad_request" || failure.kind === "invalid_response")) return null;
      throw failure;
    });
  } catch (failure) {
    if (failure instanceof IntervalsError && (failure.kind === "bad_request" || failure.kind === "invalid_response")) {
      streamsBody = null;
    } else {
      // Clé refusée : à signaler (reconnexion) ; quota ou panne passagère : reprise plus tard.
      if (!(failure instanceof IntervalsError) || failure.kind === "unauthorized") throw failure;
      return "stop";
    }
  }
  const raw = intervalsStreams(streamsBody);
  const reduced = reduceStreams(raw);
  const laps = intervalsLaps(lapsBody);
  const { error: saveError } = await deps.admin.from("activity_streams").upsert(
    {
      activity_id: activity.id,
      sample_s: reduced?.sample_s ?? 1,
      series: (reduced?.series ?? {}) as unknown as NonNullable<Json>,
      laps: laps as unknown as NonNullable<Json>,
      laps_origin: laps.length ? "detected" : null,
      bests: powerBests(raw) as unknown as NonNullable<Json>,
      metrics: streamMetrics(raw, activity.sport) as unknown as NonNullable<Json>,
    },
    { onConflict: "activity_id" },
  );
  // Activité effacée entre-temps : rien à garder.
  if (saveError && saveError.code !== "23503") throw new Error(`Courbes non enregistrées : ${saveError.message}`);
  return "read";
}

/** Lit les détails en attente, deux activités à la fois, dans la limite donnée et le temps imparti. */
async function readDetails(deps: IntervalsDeps, connection: DeviceConnection, today: string, options: { max: number; budgetMs: number }): Promise<DetailsProgress> {
  const { total, missing } = await detailsBacklog(deps, connection.athlete_id, today);
  if (!missing.length) return { read: 0, remaining: 0, total, paused: false };
  const key = await apiKey(deps, connection);
  const queue = missing.slice(0, options.max);
  const started = Date.now();
  let next = 0;
  let read = 0;
  let paused = false;
  let failure: unknown = null;
  const worker = async () => {
    while (!paused && failure === null && Date.now() - started <= options.budgetMs) {
      const activity = queue[next];
      if (!activity) return;
      next += 1;
      try {
        if ((await readActivityDetails(deps, key, activity)) === "stop") {
          paused = true;
          return;
        }
        read += 1;
      } catch (error) {
        // L'autre lecture s'arrête aussi : rien ne continue après l'échec signalé.
        failure ??= error;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAILS_PARALLEL, queue.length) }, worker));
  if (failure !== null) throw failure;
  return { read, remaining: missing.length - read, total, paused };
}

/** Pendant une synchronisation : une part des détails en attente (le reste par le rattrapage). */
async function pullStreams(deps: IntervalsDeps, connection: DeviceConnection, today: string): Promise<number> {
  try {
    return (await readDetails(deps, connection, today, { max: STREAMS_PER_RUN, budgetMs: STREAMS_BUDGET_MS })).read;
  } catch (error) {
    throw await translate(deps, connection, error);
  }
}

/** Bail d'une lecture de rattrapage : un seul exécutant à la fois par compte, comme les envois. */
const DETAILS_LEASE_SECONDS = 90;

export type DetailsResult = ({ status: "ok" } & DetailsProgress) | { status: "not_linked" } | { status: "busy" } | { status: "reauth" };

/**
 * Rattrapage des détails (courbes, intervalles, records) des activités de l'année, demandé tant que
 * TriCoach est ouvert et chaque nuit : un lot dans le temps imparti, sous le bail du compte (jamais
 * en même temps qu'une synchronisation). Ce qui reste est dit, rien n'est deviné.
 */
export async function readIntervalsDetails(deps: IntervalsDeps, athleteId: string, options: { budgetMs: number; max?: number }): Promise<DetailsResult> {
  const connection = await intervalsConnection(deps, athleteId);
  if (!connection) return { status: "not_linked" };
  if (connection.status !== "active") return { status: "reauth" };
  const { data: leased } = await deps.admin.rpc("acquire_sync_lease", { p_connection: connection.id, p_seconds: DETAILS_LEASE_SECONDS });
  if (!leased) return { status: "busy" };
  try {
    const today = await todayOf(deps, athleteId);
    return { status: "ok", ...(await readDetails(deps, connection, today, { max: options.max ?? 400, budgetMs: options.budgetMs })) };
  } catch (error) {
    // Clé refusée : la connexion passe « à reconnecter », comme pendant une synchronisation.
    const translated = await translate(deps, connection, error);
    if (translated instanceof DeviceReauthError) return { status: "reauth" };
    throw translated;
  } finally {
    await deps.admin.rpc("release_sync_lease", { p_connection: connection.id });
  }
}

/** Chaque nuit : un lot de détails pour chaque compte relié, dans le temps imparti (le reste à l'ouverture). */
export async function readIntervalsDetailsDaily(deps: IntervalsDeps, budgetMs: number): Promise<{ read: number; remaining: number }> {
  const started = Date.now();
  const { data: connections } = await deps.admin.from("external_connections").select("athlete_id").eq("provider", "intervals").eq("status", "active");
  const total = { read: 0, remaining: 0 };
  for (const connection of connections ?? []) {
    const left = budgetMs - (Date.now() - started);
    if (left < 2000) break;
    const result = await readIntervalsDetails(deps, connection.athlete_id, { budgetMs: left });
    if (result.status === "ok") {
      total.read += result.read;
      total.remaining += result.remaining;
    }
  }
  return total;
}

/** Exécute les dépôts dus (un seul à la fois par compte), dans le temps imparti. */
export const runIntervalsJobs = (deps: IntervalsDeps, options: { limit?: number; budgetMs?: number } = {}) =>
  runDeviceJobs(deps, "intervals", (connection) => syncIntervals(deps, connection), options);

/** Tâche quotidienne : la fenêtre de 14 jours avance d'un jour. */
export const enqueueDailyIntervals = (deps: IntervalsDeps) => enqueueDailyDevice(deps, "intervals");
