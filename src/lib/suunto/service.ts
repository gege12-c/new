/**
 * Envoi des séances sur la montre Suunto, côté serveur : connexion et déconnexion du compte Suunto,
 * jetons, synchronisation des guides, file de jobs. Tout passe par des dépendances explicites
 * (client base « serveur », API, clé, horloge) : les tests les remplacent par une base locale et un
 * faux Suunto.
 *
 * La synchronisation d'un athlète est un rapprochement, idempotent : les guides attendus (séances
 * publiées d'aujourd'hui à J+6, date locale de l'athlète) sont comparés à la liste lue chez Suunto ;
 * ce qui manque est créé, ce qui a changé est remplacé, ce qui n'est plus prévu est retiré. Un envoi
 * interrompu se rattrape donc au passage suivant, sans doublon (identifiant externe unique par compte).
 */
import "server-only";
import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { addDays } from "@/lib/planning/dates";
import type { AdminClient } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/supabase/schema";
import type { Json } from "@/lib/supabase/database.types";
import { currentThresholds, toAthleteThresholds, type ThresholdRow } from "@/lib/thresholds";
import { localDate } from "@/lib/utils";
import { parseWorkout } from "@/lib/workout/schema";
import { SuuntoApi, SuuntoError, type Fetcher, type RemoteGuide, type SuuntoTokens } from "./api";
import type { SuuntoSettings } from "./config";
import { buildGuides, externalIdFor, GUIDE_FORMAT_VERSION, GUIDE_WINDOW_DAYS, type GuideBuild } from "./guide";
import { packGuide } from "./zip";
import {
  DeviceConfigError,
  DeviceDeferError,
  DeviceReauthError,
  deviceLog,
  enqueueDailyDevice,
  enqueueDeviceSync,
  markReauth as markConnectionReauth,
  runDeviceJobs,
  type DeviceConnection,
} from "@/lib/devices/jobs";

export interface SuuntoDeps {
  admin: AdminClient;
  api: SuuntoApi;
  key: Buffer;
  settings: SuuntoSettings;
  /** Adresse publique de TriCoach : retour OAuth et liens des guides. */
  siteUrl: string;
  now: () => Date;
  /** Pause entre deux écritures chez Suunto : les envois sont espacés. */
  pause: (ms: number) => Promise<void>;
  writeGapMs: number;
}

type Connection = DeviceConnection;

export const SUUNTO_CALLBACK_PATH = "/api/suunto/callback";
const PREFIX = "tricoach-";

export function makeSuuntoApi(settings: SuuntoSettings, fetcher?: Fetcher, now: () => Date = () => new Date()) {
  return new SuuntoApi(settings, fetcher, now);
}

export const redirectUri = (deps: Pick<SuuntoDeps, "siteUrl">) => `${deps.siteUrl}${SUUNTO_CALLBACK_PATH}`;

const log = (deps: SuuntoDeps, entry: Parameters<typeof deviceLog>[2]) => deviceLog(deps.admin, "suunto", entry);

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

function tokenRow(deps: SuuntoDeps, connectionId: string, tokens: SuuntoTokens) {
  return {
    access_token: encryptSecret(tokens.accessToken, deps.key, `${connectionId}:access`),
    refresh_token: encryptSecret(tokens.refreshToken, deps.key, `${connectionId}:refresh`),
    expires_at: tokens.expiresAt.toISOString(),
    updated_at: deps.now().toISOString(),
  };
}

const markReauth = (deps: SuuntoDeps, connection: Connection, quiet = false) => markConnectionReauth(deps.admin, "suunto", connection, deps.now(), quiet);

/**
 * Jeton d'accès valide, renouvelé s'il expire dans moins de 5 minutes (ou s'il vient d'être refusé).
 * Le jeton de renouvellement change à chaque usage : deux renouvellements simultanés sont départagés
 * par la révision, le perdant relit le jeton du gagnant.
 */
async function accessTokenFor(deps: SuuntoDeps, connection: Connection, rejected = false, quiet = false): Promise<string> {
  let seenRevision: number | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row } = await deps.admin
      .from("oauth_tokens")
      .select("access_token, refresh_token, expires_at, revision")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (!row) {
      await markReauth(deps, connection, quiet);
      throw new DeviceReauthError("suunto");
    }
    // Renouvelé entre-temps par un autre envoi : ce jeton-là est neuf.
    if (seenRevision !== null && row.revision !== seenRevision) return decryptSecret(row.access_token, deps.key, `${connection.id}:access`);
    seenRevision = row.revision;
    if (!rejected && new Date(row.expires_at).getTime() - deps.now().getTime() > 5 * 60_000) {
      return decryptSecret(row.access_token, deps.key, `${connection.id}:access`);
    }
    let tokens: SuuntoTokens;
    try {
      tokens = await deps.api.refresh(decryptSecret(row.refresh_token, deps.key, `${connection.id}:refresh`));
    } catch (error) {
      if (error instanceof SuuntoError && error.kind === "unauthorized") {
        if (attempt === 0) continue;
        await markReauth(deps, connection, quiet);
        throw new DeviceReauthError("suunto");
      }
      if (error instanceof SuuntoError && error.kind === "rate_limited") throw new DeviceDeferError(error.retryAt ?? new Date(deps.now().getTime() + 120_000));
      throw error;
    }
    const { data: updated } = await deps.admin
      .from("oauth_tokens")
      .update({ ...tokenRow(deps, connection.id, tokens), revision: row.revision + 1 })
      .eq("connection_id", connection.id)
      .eq("revision", row.revision)
      .select("connection_id");
    if (updated?.length) return tokens.accessToken;
  }
  const { data: latest } = await deps.admin.from("oauth_tokens").select("access_token").eq("connection_id", connection.id).maybeSingle();
  if (!latest) throw new DeviceReauthError("suunto");
  return decryptSecret(latest.access_token, deps.key, `${connection.id}:access`);
}

/** Appel à Suunto avec un jeton valide ; refusé, le jeton est renouvelé une fois avant de conclure. */
async function withToken<T>(deps: SuuntoDeps, connection: Connection, call: (token: string) => Promise<T>, quiet = false): Promise<T> {
  const attempt = async (rejected: boolean) => call(await accessTokenFor(deps, connection, rejected, quiet));
  try {
    return await attempt(false);
  } catch (error) {
    if (!(error instanceof SuuntoError && error.kind === "unauthorized")) throw translate(deps, error);
  }
  try {
    return await attempt(true);
  } catch (error) {
    if (error instanceof SuuntoError && error.kind === "unauthorized") {
      await markReauth(deps, connection, quiet);
      throw new DeviceReauthError("suunto");
    }
    throw translate(deps, error);
  }
}

/** Quota → report ; service absent ou clé refusée → réglage de l'accès partenaire. */
function translate(deps: SuuntoDeps, error: unknown): unknown {
  if (!(error instanceof SuuntoError)) return error;
  if (error.kind === "rate_limited") return new DeviceDeferError(error.retryAt ?? new Date(deps.now().getTime() + 120_000));
  if (error.kind === "forbidden" || error.kind === "unavailable") {
    return new DeviceConfigError("not_permitted", "Suunto refuse l'accès aux guides : abonnement ou clé d'abonnement à vérifier.");
  }
  return error;
}

// ---------------------------------------------------------------------------
// Connexion et déconnexion
// ---------------------------------------------------------------------------

export type ConnectResult = { status: "connected"; connectionId: string } | { status: "already_linked" };

const enqueue = (deps: SuuntoDeps, athleteId: string, dedupeKey?: string) => enqueueDeviceSync(deps.admin, "suunto", athleteId, dedupeKey);

/** Échange du code d'autorisation, jetons chiffrés, puis premier envoi des séances à venir. */
export async function connectSuunto(deps: SuuntoDeps, athleteId: string, code: string): Promise<ConnectResult> {
  const tokens = await deps.api.exchangeCode(code, redirectUri(deps));
  if (!tokens.user) throw new Error("Suunto n'a pas indiqué quel compte est relié.");

  const { data: taken } = await deps.admin
    .from("external_connections")
    .select("athlete_id")
    .eq("provider", "suunto")
    .eq("external_athlete_id", tokens.user)
    .maybeSingle();
  if (taken && taken.athlete_id !== athleteId) return { status: "already_linked" };

  const { data: previous } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "suunto")
    .maybeSingle();
  // Autre compte Suunto : les guides envoyés à l'ancien en sont retirés (si son accès vaut encore).
  if (previous && previous.external_athlete_id !== tokens.user) {
    await removeAllGuides(deps, previous).catch(() => undefined);
    await deps.admin.from("external_connections").delete().eq("id", previous.id);
  }

  const { data: connection, error } = await deps.admin
    .from("external_connections")
    .upsert(
      {
        athlete_id: athleteId,
        provider: "suunto",
        external_athlete_id: tokens.user,
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
  if (error || !connection) throw new Error(`Connexion Suunto non enregistrée : ${error?.message ?? "inconnue"}`);
  const { error: tokenError } = await deps.admin
    .from("oauth_tokens")
    .upsert({ connection_id: connection.id, ...tokenRow(deps, connection.id, tokens), revision: 1 }, { onConflict: "connection_id" });
  if (tokenError) throw new Error(`Enregistrement des jetons impossible : ${tokenError.message}`);
  await enqueue(deps, athleteId);
  await log(deps, { level: "info", event: "suunto_connected", athleteId });
  return { status: "connected", connectionId: connection.id };
}

/** Guides TriCoach du compte (identifiant externe « tricoach-… » ou déjà connus de TriCoach). */
function ours(deps: SuuntoDeps, remote: RemoteGuide[], knownIds: Set<string>) {
  return remote.filter(
    (g) => knownIds.has(g.id) || (g.externalId?.startsWith(PREFIX) && (g.owner === null || g.owner === deps.settings.appName)),
  );
}

/** Retire du compte Suunto tous les guides envoyés par TriCoach (sans prévenir l'athlète d'un refus d'accès). */
async function removeAllGuides(deps: SuuntoDeps, connection: Connection) {
  const { data: rows } = await deps.admin.from("device_workouts").select("remote_id").eq("connection_id", connection.id);
  const known = new Set((rows ?? []).map((r) => r.remote_id).filter((id): id is string => Boolean(id)));
  const remote = await withToken(deps, connection, (token) => deps.api.listGuides(token), true);
  let first = true;
  for (const guide of ours(deps, remote, known)) {
    if (!first) await deps.pause(deps.writeGapMs);
    first = false;
    await withToken(deps, connection, (token) => deps.api.deleteGuide(token, guide.id), true);
  }
}

/** Retire les séances envoyées sur la montre (si Suunto répond), puis oublie le compte et ses jetons. */
export async function disconnectSuunto(deps: SuuntoDeps, athleteId: string): Promise<{ removed: boolean }> {
  const { data: connection } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "suunto")
    .maybeSingle();
  if (!connection) return { removed: true };
  const removed = await removeAllGuides(deps, connection).then(
    () => true,
    () => false,
  );
  // Cascade : jetons et état des guides.
  await deps.admin.from("external_connections").delete().eq("id", connection.id);
  await deps.admin.from("sync_jobs").delete().eq("athlete_id", athleteId).eq("kind", "suunto_sync").in("status", ["pending", "failed"]);
  await log(deps, { level: "info", event: removed ? "suunto_disconnected" : "suunto_disconnected_guides_left", athleteId });
  return { removed };
}

/** Nouvel envoi demandé par l'athlète : les guides refusés sont retentés. */
export async function resendSuunto(deps: SuuntoDeps, athleteId: string) {
  const { data: connection } = await deps.admin
    .from("external_connections")
    .select("id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "suunto")
    .maybeSingle();
  if (!connection || connection.status !== "active") return false;
  await deps.admin.from("device_workouts").delete().eq("connection_id", connection.id).eq("status", "failed");
  await enqueue(deps, athleteId, `suunto:manual:${athleteId}:${Math.floor(deps.now().getTime() / 60_000)}`);
  return true;
}

// ---------------------------------------------------------------------------
// Synchronisation d'un athlète
// ---------------------------------------------------------------------------

interface Desired {
  externalId: string;
  sessionId: string;
  segmentIndex: number;
  date: string;
  version: number;
  build: GuideBuild;
  hash: string;
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Adresse de la séance dans TriCoach, ouverte depuis l'application Suunto. */
const sessionUrl = (deps: SuuntoDeps, sessionId: string, date: string) =>
  `${deps.siteUrl}/athlete/calendar?${new URLSearchParams({ view: "day", date, session: sessionId })}`;

/** Guides attendus : séances publiées d'aujourd'hui à J+6 (date locale de l'athlète). */
async function desiredGuides(deps: SuuntoDeps, athleteId: string): Promise<Map<string, Desired>> {
  const { data: profile } = await deps.admin.from("profiles").select("timezone").eq("id", athleteId).maybeSingle();
  const today = localDate(profile?.timezone ?? "Europe/Paris", deps.now());
  // Seulement les séances de TriCoach : celles reprises d'intervals.icu partent déjà par intervals.icu.
  const published = (onlyOwn: boolean) => {
    const query = deps.admin
      .from("planned_sessions")
      .select("id, scheduled_date, title, description, nutrition_notes, content, version")
      .eq("athlete_id", athleteId)
      .eq("state", "published")
      .gte("scheduled_date", today)
      .lte("scheduled_date", addDays(today, GUIDE_WINDOW_DAYS - 1));
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
    const builds: GuideBuild[] = workout.success
      ? buildGuides(workout.data, {
          sessionId: session.id,
          title: session.title,
          description: session.description,
          nutrition: session.nutrition_notes,
          date: session.scheduled_date,
          url: sessionUrl(deps, session.id, session.scheduled_date),
          owner: deps.settings.appName,
          thresholds: toAthleteThresholds(currentThresholds((thresholds.data ?? []) as ThresholdRow[], session.scheduled_date)),
          activities: deps.settings.activities,
        })
      : [
          {
            segmentIndex: 0,
            sport: "other",
            externalId: externalIdFor(session.id, 0),
            issues: [{ severity: "blocking", message: "Contenu de la séance invalide : à corriger dans TriCoach." }],
            guide: null,
            manifest: null,
          },
        ];
    for (const build of builds) {
      desired.set(build.externalId, {
        externalId: build.externalId,
        sessionId: session.id,
        segmentIndex: build.segmentIndex,
        date: session.scheduled_date,
        version: session.version,
        build,
        hash: sha256({ format: GUIDE_FORMAT_VERSION, guide: build.guide, manifest: build.manifest, blocked: build.guide ? null : build.issues }),
      });
    }
  }
  return desired;
}

export interface SyncReport {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
}

/** Rapproche les guides du compte Suunto des séances attendues ; renvoie ce qui a été fait. */
export async function syncAthlete(deps: SuuntoDeps, connection: Connection): Promise<SyncReport> {
  const report: SyncReport = { created: 0, updated: 0, deleted: 0, failed: 0 };
  const desired = await desiredGuides(deps, connection.athlete_id);
  const { data: rows, error } = await deps.admin
    .from("device_workouts")
    .select("id, external_id, remote_id, content_hash, status")
    .eq("connection_id", connection.id);
  if (error) throw new Error(`État des guides illisible : ${error.message}`);
  const rowsByExternal = new Map((rows ?? []).map((r) => [r.external_id, r]));
  const known = new Set((rows ?? []).map((r) => r.remote_id).filter((id): id is string => Boolean(id)));

  let remote = await withToken(deps, connection, (token) => deps.api.listGuides(token));
  const mine = () => ours(deps, remote, known);
  const remoteFor = (d: Desired) => {
    const row = rowsByExternal.get(d.externalId);
    return mine().find((g) => g.externalId === d.externalId) ?? (row?.remote_id ? mine().find((g) => g.id === row.remote_id) : undefined);
  };

  // Guides de la séance attendue (gardés) et guides déjà retirés pendant ce passage.
  const keep = new Set<string>();
  const removed = new Set<string>();
  let writes = 0;
  const write = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
    if (writes > 0) await deps.pause(deps.writeGapMs);
    writes += 1;
    return withToken(deps, connection, call);
  };
  const save = async (d: Desired, values: { status: "sent" | "failed"; remote_id: string | null; last_error: string | null }) => {
    const { error: saveError } = await deps.admin.from("device_workouts").upsert(
      {
        connection_id: connection.id,
        provider: "suunto",
        athlete_id: connection.athlete_id,
        session_id: d.sessionId,
        segment_index: d.segmentIndex,
        external_id: d.externalId,
        session_version: d.version,
        content_hash: d.hash,
        scheduled_date: d.date,
        issues: d.build.issues as unknown as NonNullable<Json>,
        sent_at: values.status === "sent" ? deps.now().toISOString() : null,
        ...values,
      },
      { onConflict: "connection_id,external_id" },
    );
    if (saveError) throw new Error(`État du guide non enregistré : ${saveError.message}`);
  };
  /** Identifiant chez Suunto d'un guide créé, relu dans la liste si la réponse ne le donnait pas. */
  const lookup = async (externalId: string) => {
    remote = await withToken(deps, connection, (token) => deps.api.listGuides(token));
    return remote.find((g) => g.externalId === externalId)?.id ?? null;
  };

  for (const d of desired.values()) {
    const row = rowsByExternal.get(d.externalId);
    const existing = remoteFor(d);
    const { guide, manifest } = d.build;

    if (!guide || !manifest) {
      // Impossible à convertir : pas de version périmée sur la montre, et la raison est gardée.
      if (existing) {
        await write((token) => deps.api.deleteGuide(token, existing.id));
        removed.add(existing.id);
        report.deleted += 1;
      }
      if (!(row?.status === "failed" && row.content_hash === d.hash)) {
        const blocking = d.build.issues.find((i) => i.severity === "blocking");
        await save(d, { status: "failed", remote_id: null, last_error: (blocking?.message ?? "Séance impossible à convertir.").slice(0, 300) });
      }
      report.failed += 1;
      continue;
    }
    // Déjà à jour, ou déjà refusé tel quel par Suunto : rien à refaire.
    if (existing && row?.status === "sent" && row.remote_id === existing.id && row.content_hash === d.hash) {
      keep.add(existing.id);
      continue;
    }
    if (!existing && row?.status === "failed" && row.content_hash === d.hash) {
      report.failed += 1;
      continue;
    }

    const zip = packGuide(guide, manifest);
    try {
      let id: string | null;
      if (existing) {
        await write((token) => deps.api.updateGuide(token, existing.id, zip));
        id = existing.id;
        report.updated += 1;
      } else {
        try {
          id = (await write((token) => deps.api.createGuide(token, zip))) ?? (await lookup(d.externalId));
        } catch (error) {
          // Déjà chez Suunto (envoi précédent interrompu avant d'être noté) : on le remplace.
          if (!(error instanceof SuuntoError && error.kind === "conflict")) throw error;
          id = await lookup(d.externalId);
          if (!id) throw error;
          const found = id;
          await write((token) => deps.api.updateGuide(token, found, zip));
        }
        if (!id) throw new SuuntoError("invalid_response", "Guide créé chez Suunto mais introuvable dans la liste.");
        report.created += 1;
      }
      known.add(id);
      keep.add(id);
      await save(d, { status: "sent", remote_id: id, last_error: null });
    } catch (error) {
      if (!(error instanceof SuuntoError && error.kind === "bad_request")) throw error;
      if (/owner/i.test(error.detail ?? "")) {
        throw new DeviceConfigError("app_name_mismatch", "Suunto refuse les guides : SUUNTO_APP_NAME diffère du nom de l'application enregistrée chez Suunto.");
      }
      // Guide refusé tel quel : l'ancienne version ne reste pas sur la montre.
      if (existing) {
        await write((token) => deps.api.deleteGuide(token, existing.id)).catch(() => undefined);
        removed.add(existing.id);
      }
      await save(d, { status: "failed", remote_id: null, last_error: "Suunto a refusé ce guide : la séance est à revoir dans TriCoach." });
      await log(deps, { level: "warn", event: "suunto_guide_refused", message: error.detail?.slice(0, 300), athleteId: connection.athlete_id });
      report.failed += 1;
    }
  }

  // Retraits : séances annulées, supprimées, repassées en brouillon, déplacées hors de la fenêtre ou passées.
  const expected = new Set(desired.keys());
  for (const guide of mine()) {
    if (keep.has(guide.id) || removed.has(guide.id) || (guide.externalId && expected.has(guide.externalId))) continue;
    await write((token) => deps.api.deleteGuide(token, guide.id));
    report.deleted += 1;
  }
  const stale = (rows ?? []).filter((r) => !expected.has(r.external_id)).map((r) => r.id);
  if (stale.length) await deps.admin.from("device_workouts").delete().in("id", stale);

  await deps.admin
    .from("external_connections")
    .update({ last_sync_at: deps.now().toISOString(), last_error: null, last_error_at: null })
    .eq("id", connection.id);
  return report;
}

// ---------------------------------------------------------------------------
// File de jobs
// ---------------------------------------------------------------------------

/** Exécute les envois Suunto dus (un seul à la fois par compte), dans le temps imparti. */
export const runSuuntoJobs = (deps: SuuntoDeps, options: { limit?: number; budgetMs?: number } = {}) =>
  runDeviceJobs(deps, "suunto", (connection) => syncAthlete(deps, connection), options);

/** Tâche quotidienne : la fenêtre avance d'un jour (séance de J+6 à envoyer, séance d'hier à retirer). */
export const enqueueDailySuunto = (deps: SuuntoDeps) => enqueueDailyDevice(deps, "suunto");
