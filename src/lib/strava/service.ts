/**
 * Intégration Strava côté serveur : connexion et déconnexion, réception des webhooks, file de jobs.
 * Tout passe par des dépendances explicites (client base « serveur », API, clé, horloge) : les tests
 * les remplacent par une base locale et un faux Strava.
 *
 * Règles appliquées (politique API Strava du 1er juin 2026) :
 * - activités visibles de l'athlète seul, gardées 6 jours au plus (la base l'impose aussi) ;
 * - suppression reflétée dès l'évènement (au plus 48 h exigées), déconnexion = effacement immédiat ;
 * - quotas respectés : on s'arrête avant la limite et on reprend à la fenêtre suivante.
 */
import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import type { Json } from "@/lib/supabase/database.types";
import type { AdminClient } from "@/lib/supabase/admin";
import { quotaWaitUntil, StravaApi, StravaError, type RateLimitSnapshot } from "./api";
import { STRAVA_CACHE_DAYS, type StravaSettings } from "./config";
import { normalizeStravaActivity } from "./normalize";
import { canReadActivities, parseScopes, WebhookEventSchema, type SummaryActivity, type TokenResponse, type WebhookEvent } from "./schemas";

export interface StravaDeps {
  admin: AdminClient;
  api: StravaApi;
  key: Buffer;
  settings: StravaSettings;
  now: () => Date;
}

/** L'athlète a retiré l'accès, ou ses jetons ne sont plus acceptés : il doit se reconnecter. */
export class StravaReauthError extends Error {
  constructor() {
    super("Reconnexion à Strava nécessaire.");
    this.name = "StravaReauthError";
  }
}

/** Quota atteint : le job attend la fenêtre suivante sans compter d'échec. */
export class StravaDeferError extends Error {
  constructor(readonly until: Date) {
    super("Quota Strava presque atteint : reprise à la fenêtre suivante.");
    this.name = "StravaDeferError";
  }
}

type Connection = { id: string; athlete_id: string; external_athlete_id: string; status: string };
type SyncJob = { id: number; kind: string; athlete_id: string | null; payload: Json; attempts: number; max_attempts: number };

const DAY_MS = 86_400_000;

export function makeStravaApi(settings: StravaSettings, admin: AdminClient, fetcher?: ConstructorParameters<typeof StravaApi>[1], now: () => Date = () => new Date()) {
  return new StravaApi(settings, fetcher, (snapshot) => recordRateLimit(admin, snapshot, now()), now);
}

async function recordRateLimit(admin: AdminClient, snapshot: RateLimitSnapshot, at: Date) {
  await admin
    .from("provider_state")
    .upsert({ provider: "strava", rate_limit: snapshot as unknown as Json, rate_observed_at: at.toISOString() }, { onConflict: "provider" });
}

/** Avant d'appeler Strava : quota presque épuisé ou blocage en cours → on reporte. */
async function ensureQuota(deps: StravaDeps) {
  const { data } = await deps.admin.from("provider_state").select("rate_limit, rate_observed_at, blocked_until").eq("provider", "strava").maybeSingle();
  if (!data) return;
  const now = deps.now();
  if (data.blocked_until && new Date(data.blocked_until) > now) throw new StravaDeferError(new Date(data.blocked_until));
  const observed = data.rate_observed_at ? new Date(data.rate_observed_at) : null;
  const snapshot = data.rate_limit as unknown as RateLimitSnapshot | null;
  if (!observed || !snapshot) return;
  const wait = quotaWaitUntil(snapshot, observed);
  if (wait && wait > now) throw new StravaDeferError(wait);
}

export async function logSync(
  admin: AdminClient,
  entry: { level: "info" | "warn" | "error"; event: string; message?: string; athleteId?: string | null; jobId?: number | null; provider?: "strava" | "fit" },
) {
  await admin.from("sync_logs").insert({
    level: entry.level,
    provider: entry.provider ?? "strava",
    event: entry.event.slice(0, 80),
    message: entry.message?.slice(0, 500) ?? null,
    athlete_id: entry.athleteId ?? null,
    job_id: entry.jobId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

async function saveTokens(deps: StravaDeps, connectionId: string, tokens: TokenResponse) {
  const row = {
    connection_id: connectionId,
    access_token: encryptSecret(tokens.access_token, deps.key, `${connectionId}:access`),
    refresh_token: encryptSecret(tokens.refresh_token, deps.key, `${connectionId}:refresh`),
    expires_at: new Date(tokens.expires_at * 1000).toISOString(),
    updated_at: deps.now().toISOString(),
  };
  const { error } = await deps.admin.from("oauth_tokens").upsert({ ...row, revision: 1 }, { onConflict: "connection_id" });
  if (error) throw new Error(`Enregistrement des jetons impossible : ${error.message}`);
}

async function markReauth(deps: StravaDeps, connection: Connection) {
  await deps.admin
    .from("external_connections")
    .update({ status: "reauth_required", last_error: "reauth_required", last_error_at: deps.now().toISOString() })
    .eq("id", connection.id);
  await logSync(deps.admin, { level: "warn", event: "strava_reauth_required", athleteId: connection.athlete_id });
}

/**
 * Jeton d'accès valide pour une connexion, renouvelé s'il expire dans moins de 5 minutes.
 * Deux renouvellements simultanés : le second relit le jeton du premier (contrôle de révision).
 */
export async function accessTokenFor(deps: StravaDeps, connection: Connection): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row } = await deps.admin
      .from("oauth_tokens")
      .select("access_token, refresh_token, expires_at, revision")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (!row) {
      await markReauth(deps, connection);
      throw new StravaReauthError();
    }
    if (new Date(row.expires_at).getTime() - deps.now().getTime() > 5 * 60_000) {
      return decryptSecret(row.access_token, deps.key, `${connection.id}:access`);
    }
    await ensureQuota(deps);
    let tokens: TokenResponse;
    try {
      tokens = await deps.api.refresh(decryptSecret(row.refresh_token, deps.key, `${connection.id}:refresh`));
    } catch (error) {
      if (error instanceof StravaError && (error.kind === "unauthorized" || error.kind === "bad_request" || error.kind === "forbidden")) {
        if (attempt === 0) continue; // un autre serveur a peut-être déjà renouvelé : on relit une fois
        await markReauth(deps, connection);
        throw new StravaReauthError();
      }
      throw error;
    }
    const { data: updated } = await deps.admin
      .from("oauth_tokens")
      .update({
        access_token: encryptSecret(tokens.access_token, deps.key, `${connection.id}:access`),
        refresh_token: encryptSecret(tokens.refresh_token, deps.key, `${connection.id}:refresh`),
        expires_at: new Date(tokens.expires_at * 1000).toISOString(),
        revision: row.revision + 1,
        updated_at: deps.now().toISOString(),
      })
      .eq("connection_id", connection.id)
      .eq("revision", row.revision)
      .select("connection_id");
    if (updated?.length) return tokens.access_token;
  }
  // Renouvelé ailleurs entre-temps : le jeton enregistré est le bon.
  const { data: latest } = await deps.admin.from("oauth_tokens").select("access_token").eq("connection_id", connection.id).maybeSingle();
  if (!latest) throw new StravaReauthError();
  return decryptSecret(latest.access_token, deps.key, `${connection.id}:access`);
}

/** Appel à Strava avec un jeton valide ; un refus d'autorisation passe la connexion en « reconnexion nécessaire ». */
async function withToken<T>(deps: StravaDeps, connection: Connection, call: (token: string) => Promise<T>): Promise<T> {
  await ensureQuota(deps);
  const token = await accessTokenFor(deps, connection);
  try {
    return await call(token);
  } catch (error) {
    if (error instanceof StravaError && error.kind === "unauthorized") {
      await markReauth(deps, connection);
      throw new StravaReauthError();
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Connexion et déconnexion
// ---------------------------------------------------------------------------

export type ConnectResult =
  | { status: "connected"; connectionId: string }
  | { status: "missing_scope" }
  | { status: "already_linked" };

export async function connectStrava(deps: StravaDeps, athleteId: string, code: string, grantedScope: string | null): Promise<ConnectResult> {
  await ensureQuota(deps);
  const tokens = await deps.api.exchangeCode(code);
  const scopes = parseScopes(tokens.scope ?? grantedScope);
  if (!canReadActivities(scopes)) {
    await deps.api.revoke(tokens.refresh_token, "refresh_token").catch(() => undefined);
    return { status: "missing_scope" };
  }
  const externalId = String(tokens.athlete?.id ?? (await deps.api.getAthlete(tokens.access_token)).id);

  const { data: taken } = await deps.admin
    .from("external_connections")
    .select("athlete_id")
    .eq("provider", "strava")
    .eq("external_athlete_id", externalId)
    .maybeSingle();
  // Ce compte Strava est déjà relié à un autre compte TriCoach : on ne touche pas à son accès.
  if (taken && taken.athlete_id !== athleteId) return { status: "already_linked" };

  const { data: previous } = await deps.admin
    .from("external_connections")
    .select("id, external_athlete_id")
    .eq("athlete_id", athleteId)
    .eq("provider", "strava")
    .maybeSingle();
  // Reconnexion avec un autre compte Strava : les activités de l'ancien compte sont effacées.
  if (previous && previous.external_athlete_id !== externalId) {
    await deps.admin.from("external_connections").delete().eq("id", previous.id);
  }

  const { data: connection, error } = await deps.admin
    .from("external_connections")
    .upsert(
      {
        athlete_id: athleteId,
        provider: "strava",
        external_athlete_id: externalId,
        scopes,
        status: "active",
        connected_at: deps.now().toISOString(),
        last_error: null,
        last_error_at: null,
      },
      { onConflict: "athlete_id,provider" },
    )
    .select("id")
    .single();
  if (error || !connection) throw new Error(`Connexion Strava non enregistrée : ${error?.message ?? "inconnue"}`);
  await saveTokens(deps, connection.id, tokens);
  await enqueueSync(deps, connection.id, athleteId, `connect:${deps.now().getTime()}`);
  await logSync(deps.admin, { level: "info", event: "strava_connected", athleteId });
  return { status: "connected", connectionId: connection.id };
}

/** Révoque l'accès chez Strava (si possible) et efface aussitôt connexion, jetons et activités. */
export async function disconnectStrava(deps: StravaDeps, athleteId: string): Promise<{ revoked: boolean }> {
  const { data: connection } = await deps.admin
    .from("external_connections")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("provider", "strava")
    .maybeSingle();
  if (!connection) return { revoked: true };
  let revoked = false;
  const { data: tokens } = await deps.admin.from("oauth_tokens").select("refresh_token").eq("connection_id", connection.id).maybeSingle();
  if (tokens) {
    try {
      await deps.api.revoke(decryptSecret(tokens.refresh_token, deps.key, `${connection.id}:refresh`), "refresh_token");
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  await purgeConnection(deps, { id: connection.id, athlete_id: athleteId }, revoked ? "strava_disconnected" : "strava_disconnected_without_revoke");
  return { revoked };
}

async function purgeConnection(deps: StravaDeps, connection: { id: string; athlete_id: string }, event: string) {
  // Cascade : jetons, activités Strava et leurs rapprochements.
  await deps.admin.from("external_connections").delete().eq("id", connection.id);
  await deps.admin
    .from("sync_jobs")
    .delete()
    .eq("athlete_id", connection.athlete_id)
    .in("kind", ["strava_event", "strava_sync"])
    .in("status", ["pending", "failed"]);
  await logSync(deps.admin, { level: "info", event, athleteId: connection.athlete_id });
}

// ---------------------------------------------------------------------------
// Webhooks et jobs
// ---------------------------------------------------------------------------

export async function enqueueSync(deps: StravaDeps, connectionId: string, athleteId: string, reason: string) {
  const { error } = await deps.admin
    .from("sync_jobs")
    .upsert(
      { kind: "strava_sync", athlete_id: athleteId, payload: { connection_id: connectionId }, dedupe_key: `strava:sync:${connectionId}:${reason}` },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Synchronisation non mise en file : ${error.message}`);
}

export type WebhookOutcome = "queued" | "ignored";

/**
 * Au-delà de ce nombre d'évènements d'activité en attente pour un athlète, les suivants sont
 * regroupés en une synchronisation (une toutes les 10 minutes au plus) : un afflux d'évènements,
 * légitimes ou non, ne peut pas épuiser le quota d'appels à Strava.
 */
export const MAX_PENDING_EVENTS = 20;

/**
 * Évènement reçu de Strava : mis en file (idempotent), traité ensuite. L'évènement n'étant pas
 * signé, il ne sert que de déclencheur : les données sont toujours relues chez Strava.
 */
export async function enqueueWebhookEvent(deps: StravaDeps, event: WebhookEvent): Promise<WebhookOutcome> {
  const { data: state } = await deps.admin.from("provider_state").select("subscription_id").eq("provider", "strava").maybeSingle();
  if (!state?.subscription_id || state.subscription_id !== event.subscription_id) return "ignored";
  const connection = await connectionByOwner(deps, event.owner_id);
  if (!connection) return "ignored";
  if (event.object_type === "activity") {
    const { count, error } = await deps.admin
      .from("sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", connection.athlete_id)
      .eq("kind", "strava_event")
      .in("status", ["pending", "failed", "running"]);
    if (error) throw new Error(`File de synchronisation illisible : ${error.message}`);
    if ((count ?? 0) >= MAX_PENDING_EVENTS) {
      await enqueueSync(deps, connection.id, connection.athlete_id, `burst:${Math.floor(deps.now().getTime() / 600_000)}`);
      return "queued";
    }
  }
  const key = `strava:event:${event.object_type}:${event.object_id}:${event.aspect_type}:${event.event_time}`;
  const { error } = await deps.admin
    .from("sync_jobs")
    .upsert(
      { kind: "strava_event", athlete_id: connection.athlete_id, payload: { event: event as unknown as Json }, dedupe_key: key },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
  // Une erreur remonte : la route répond 500 et Strava renverra l'évènement.
  if (error) throw new Error(`Évènement non mis en file : ${error.message}`);
  return "queued";
}

async function connectionByOwner(deps: StravaDeps, ownerId: number): Promise<Connection | null> {
  const { data } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("provider", "strava")
    .eq("external_athlete_id", String(ownerId))
    .maybeSingle();
  return data ?? null;
}

async function connectionById(deps: StravaDeps, id: string): Promise<Connection | null> {
  const { data } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, external_athlete_id, status")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

async function upsertActivities(deps: StravaDeps, connection: Connection, activities: SummaryActivity[]) {
  // Une activité illisible est écartée sans bloquer les autres.
  const items = activities.flatMap((activity) => {
    try {
      return [normalizeStravaActivity(activity)];
    } catch {
      return [];
    }
  });
  if (!items.length) return 0;
  const { data, error } = await deps.admin.rpc("upsert_strava_activities", { p_connection: connection.id, p_items: items as unknown as Json });
  if (error) throw new Error(`Enregistrement des activités impossible : ${error.message}`);
  return data ?? 0;
}

async function deleteCached(deps: StravaDeps, connection: Connection, externalIds: string[]) {
  if (!externalIds.length) return;
  await deps.admin.from("activities").delete().eq("connection_id", connection.id).eq("source", "strava").in("external_id", externalIds);
}

/** Fenêtre utile : les activités commencées ces 7 derniers jours (au-delà, on ne peut pas les garder). */
function windowStart(deps: StravaDeps) {
  return new Date(deps.now().getTime() - (STRAVA_CACHE_DAYS + 1) * DAY_MS);
}

async function fetchActivity(deps: StravaDeps, connection: Connection, id: string): Promise<SummaryActivity | null> {
  try {
    return await withToken(deps, connection, (token) => deps.api.getActivity(token, id));
  } catch (error) {
    // Supprimée, ou devenue privée sans l'autorisation de lire les activités privées.
    if (error instanceof StravaError && (error.kind === "not_found" || error.kind === "forbidden")) return null;
    throw error;
  }
}

async function handleEvent(deps: StravaDeps, job: SyncJob) {
  const event = WebhookEventSchema.parse((job.payload as { event?: unknown }).event);
  const connection = await connectionByOwner(deps, event.owner_id);
  if (!connection) return;

  if (event.object_type === "athlete") {
    const authorized = event.updates?.authorized;
    if (authorized === false || authorized === "false") {
      // L'évènement n'est pas signé : on vérifie que l'accès est réellement retiré.
      try {
        await withToken(deps, connection, (token) => deps.api.getAthlete(token));
      } catch (error) {
        if (error instanceof StravaReauthError) {
          await purgeConnection(deps, connection, "strava_deauthorized");
          return;
        }
        throw error;
      }
    }
    return;
  }

  const id = String(event.object_id);
  const { data: cached } = await deps.admin
    .from("activities")
    .select("id")
    .eq("connection_id", connection.id)
    .eq("source", "strava")
    .eq("external_id", id)
    .maybeSingle();

  if (event.aspect_type === "delete") {
    if (!cached) return;
    // Vérifiée chez Strava : un faux évènement ne peut rien effacer.
    const still = await fetchActivity(deps, connection, id);
    if (!still) await deleteCached(deps, connection, [id]);
    return;
  }
  // Une modification d'activité absente du cache (trop ancienne, ou ignorée) ne justifie aucune lecture.
  if (event.aspect_type === "update" && !cached) return;

  const activity = await fetchActivity(deps, connection, id);
  if (!activity) {
    await deleteCached(deps, connection, [id]);
    return;
  }
  if (new Date(activity.start_date) < windowStart(deps)) {
    await deleteCached(deps, connection, [id]);
    return;
  }
  await upsertActivities(deps, connection, [activity]);
}

/** Relit les activités des 7 derniers jours ; celles qui ont disparu chez Strava disparaissent ici. */
async function handleSync(deps: StravaDeps, job: SyncJob) {
  const connectionId = (job.payload as { connection_id?: string }).connection_id;
  const connection = connectionId ? await connectionById(deps, connectionId) : null;
  if (!connection || connection.status !== "active") return;
  const after = windowStart(deps);
  const seen: SummaryActivity[] = [];
  const perPage = 50;
  for (let page = 1; page <= 4; page += 1) {
    const batch = await withToken(deps, connection, (token) =>
      deps.api.listActivities(token, { after: Math.floor(after.getTime() / 1000), page, perPage }),
    );
    seen.push(...batch);
    if (batch.length < perPage) break;
  }
  await upsertActivities(deps, connection, seen);

  const { data: cached } = await deps.admin
    .from("activities")
    .select("external_id")
    .eq("connection_id", connection.id)
    .eq("source", "strava")
    .gte("start_time", after.toISOString());
  const present = new Set(seen.map((a) => String(a.id)));
  await deleteCached(deps, connection, (cached ?? []).map((a) => a.external_id).filter((id) => !present.has(id)));
  await deps.admin
    .from("external_connections")
    .update({ last_sync_at: deps.now().toISOString(), last_error: null, last_error_at: null })
    .eq("id", connection.id);
}

async function handleMaintenance(deps: StravaDeps) {
  const { error } = await deps.admin.rpc("run_maintenance");
  if (error) throw new Error(`Maintenance impossible : ${error.message}`);
}

export function backoffDelayMs(attempts: number) {
  return Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export interface RunReport {
  done: number;
  failed: number;
  deferred: number;
}

/** Exécute les jobs dus, dans le temps imparti ; les autres restent en file pour le passage suivant. */
export async function runDueJobs(deps: StravaDeps, options: { limit?: number; budgetMs?: number } = {}): Promise<RunReport> {
  const started = Date.now();
  const report: RunReport = { done: 0, failed: 0, deferred: 0 };
  const { data: jobs, error } = await deps.admin.rpc("claim_sync_jobs", { p_limit: options.limit ?? 10 });
  if (error) throw new Error(`File de jobs inaccessible : ${error.message}`);

  for (const job of (jobs ?? []) as SyncJob[]) {
    if (Date.now() - started > (options.budgetMs ?? 8000)) {
      await deps.admin.from("sync_jobs").update({ status: "pending", attempts: job.attempts - 1, locked_at: null }).eq("id", job.id);
      continue;
    }
    try {
      if (job.kind === "strava_event") await handleEvent(deps, job);
      else if (job.kind === "strava_sync") await handleSync(deps, job);
      else await handleMaintenance(deps);
      await deps.admin
        .from("sync_jobs")
        .update({ status: "done", payload: {}, finished_at: deps.now().toISOString(), last_error: null, locked_at: null })
        .eq("id", job.id);
      report.done += 1;
    } catch (failure) {
      await recordFailure(deps, job, failure, report);
    }
  }
  return report;
}

async function recordFailure(deps: StravaDeps, job: SyncJob, failure: unknown, report: RunReport) {
  const now = deps.now();
  if (failure instanceof StravaDeferError || (failure instanceof StravaError && failure.kind === "rate_limited")) {
    const until = failure instanceof StravaDeferError ? failure.until : (failure.retryAt ?? new Date(now.getTime() + 15 * 60_000));
    if (failure instanceof StravaError) {
      await deps.admin.from("provider_state").upsert({ provider: "strava", blocked_until: until.toISOString() }, { onConflict: "provider" });
    }
    // Un report pour quota ne compte pas comme un échec.
    await deps.admin
      .from("sync_jobs")
      .update({ status: "failed", attempts: Math.max(0, job.attempts - 1), run_after: until.toISOString(), last_error: "rate_limited", locked_at: null })
      .eq("id", job.id);
    report.deferred += 1;
    return;
  }
  const reauth = failure instanceof StravaReauthError;
  const dead = reauth || job.attempts >= job.max_attempts;
  const message = failure instanceof Error ? failure.message : "Erreur inconnue.";
  await deps.admin
    .from("sync_jobs")
    .update({
      status: dead ? "dead" : "failed",
      run_after: new Date(now.getTime() + backoffDelayMs(job.attempts)).toISOString(),
      last_error: (reauth ? "reauth_required" : message).slice(0, 500),
      locked_at: null,
      ...(dead ? { finished_at: now.toISOString(), payload: {} } : {}),
    })
    .eq("id", job.id);
  if (dead && !reauth && job.athlete_id) {
    await deps.admin
      .from("external_connections")
      .update({ last_error: "sync_failed", last_error_at: now.toISOString() })
      .eq("athlete_id", job.athlete_id)
      .eq("provider", "strava");
  }
  await logSync(deps.admin, {
    level: dead ? "error" : "warn",
    event: `${job.kind}_${dead ? "abandoned" : "retry"}`,
    message: reauth ? "Reconnexion à Strava nécessaire." : message,
    athleteId: job.athlete_id,
    jobId: job.id,
  });
  report.failed += 1;
}

/** Tâche quotidienne : relecture de secours pour chaque connexion active, puis maintenance. */
export async function enqueueDailyJobs(deps: StravaDeps) {
  const day = deps.now().toISOString().slice(0, 10);
  const { data: connections } = await deps.admin.from("external_connections").select("id, athlete_id").eq("provider", "strava").eq("status", "active");
  for (const connection of connections ?? []) await enqueueSync(deps, connection.id, connection.athlete_id, `daily:${day}`);
  await deps.admin
    .from("sync_jobs")
    .upsert({ kind: "maintenance", dedupe_key: `maintenance:${day}` }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  return connections?.length ?? 0;
}
