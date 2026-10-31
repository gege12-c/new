/**
 * File des envois vers les montres (intervals.icu, Suunto), commune aux deux voies : mise en file,
 * exécution dans le temps imparti, un seul exécutant à la fois par compte relié (bail), reprise
 * après échec, report sans échec quand le fournisseur demande d'attendre.
 */
import "server-only";
import { logSync } from "@/lib/strava/service";
import type { AdminClient } from "@/lib/supabase/admin";

export type DeviceProvider = "suunto" | "intervals";

export const PROVIDER_NAMES: Record<DeviceProvider, string> = { suunto: "Suunto", intervals: "intervals.icu" };

/** L'athlète a retiré l'accès, ou sa clé n'est plus acceptée : il doit relier son compte de nouveau. */
export class DeviceReauthError extends Error {
  constructor(readonly provider: DeviceProvider) {
    super(`Reconnexion à ${PROVIDER_NAMES[provider]} nécessaire.`);
    this.name = "DeviceReauthError";
  }
}

/** Le fournisseur demande d'attendre (quota) : le job reprend plus tard sans compter d'échec. */
export class DeviceDeferError extends Error {
  constructor(readonly until: Date) {
    super("Quota du fournisseur atteint : reprise plus tard.");
    this.name = "DeviceDeferError";
  }
}

/** Réglage du site à corriger (accès partenaire, nom d'application) : rien que l'athlète puisse faire. */
export class DeviceConfigError extends Error {
  constructor(
    readonly code: "not_permitted" | "app_name_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "DeviceConfigError";
  }
}

export interface DeviceConnection {
  id: string;
  athlete_id: string;
  external_athlete_id: string;
  status: string;
}

interface JobDeps {
  admin: AdminClient;
  now: () => Date;
}

type SyncJob = { id: number; kind: string; athlete_id: string | null; attempts: number; max_attempts: number };

const LEASE_SECONDS = 180;

export const deviceLog = (admin: AdminClient, provider: DeviceProvider, entry: Omit<Parameters<typeof logSync>[1], "provider">) =>
  logSync(admin, { ...entry, provider });

/** Met un envoi en file ; la clé de déduplication évite deux jobs pour la même raison (tâche du jour…). */
export async function enqueueDeviceSync(admin: AdminClient, provider: DeviceProvider, athleteId: string, dedupeKey?: string) {
  const { error } = await admin
    .from("sync_jobs")
    .upsert({ kind: `${provider}_sync`, athlete_id: athleteId, dedupe_key: dedupeKey ?? null }, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(`Envoi vers ${PROVIDER_NAMES[provider]} non mis en file : ${error.message}`);
}

/** Tâche quotidienne : la fenêtre d'envoi avance d'un jour pour chaque compte actif. */
export async function enqueueDailyDevice(deps: JobDeps, provider: DeviceProvider): Promise<number> {
  const day = deps.now().toISOString().slice(0, 10);
  const { data: connections } = await deps.admin.from("external_connections").select("athlete_id").eq("provider", provider).eq("status", "active");
  for (const connection of connections ?? []) await enqueueDeviceSync(deps.admin, provider, connection.athlete_id, `${provider}:daily:${connection.athlete_id}:${day}`);
  return connections?.length ?? 0;
}

export function backoffDelayMs(attempts: number) {
  return Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export interface RunReport {
  done: number;
  failed: number;
  deferred: number;
}

/**
 * Exécute les envois dus d'un fournisseur, dans le temps imparti. Un envoi couvre tous les jobs du
 * compte déjà visibles : il relit les séances après les avoir vus, aucun changement ne se perd.
 */
export async function runDeviceJobs(
  deps: JobDeps,
  provider: DeviceProvider,
  sync: (connection: DeviceConnection) => Promise<unknown>,
  options: { limit?: number; budgetMs?: number } = {},
): Promise<RunReport> {
  const started = Date.now();
  const report: RunReport = { done: 0, failed: 0, deferred: 0 };
  const kind = `${provider}_sync`;
  const { data: state } = await deps.admin.from("provider_state").select("blocked_until").eq("provider", provider).maybeSingle();
  if (state?.blocked_until && new Date(state.blocked_until) > deps.now()) return report;

  const { data: jobs, error } = await deps.admin.rpc("claim_sync_jobs", { p_limit: options.limit ?? 10, p_kinds: [kind] });
  if (error) throw new Error(`File de jobs inaccessible : ${error.message}`);

  const finish = (ids: number[]) =>
    deps.admin.from("sync_jobs").update({ status: "done", payload: {}, finished_at: deps.now().toISOString(), last_error: null, locked_at: null }).in("id", ids);
  // Comptes déjà synchronisés pendant ce passage : leurs autres jobs réservés étaient visibles avant.
  const synced = new Set<string>();

  for (const job of (jobs ?? []) as SyncJob[]) {
    const putBack = (runAfter: Date) =>
      deps.admin
        .from("sync_jobs")
        .update({ status: "pending", attempts: Math.max(0, job.attempts - 1), locked_at: null, run_after: runAfter.toISOString() })
        .eq("id", job.id);
    if (Date.now() - started > (options.budgetMs ?? 8000)) {
      await putBack(deps.now());
      continue;
    }
    if (job.athlete_id && synced.has(job.athlete_id)) {
      await finish([job.id]);
      report.done += 1;
      continue;
    }
    const { data: connection } = job.athlete_id
      ? await deps.admin
          .from("external_connections")
          .select("id, athlete_id, external_athlete_id, status")
          .eq("athlete_id", job.athlete_id)
          .eq("provider", provider)
          .maybeSingle()
      : { data: null };
    if (!connection || connection.status !== "active") {
      await finish([job.id]);
      report.done += 1;
      continue;
    }
    const { data: leased } = await deps.admin.rpc("acquire_sync_lease", { p_connection: connection.id, p_seconds: LEASE_SECONDS });
    if (!leased) {
      // Un autre envoi est en cours pour ce compte : celui-ci repasse juste après.
      await putBack(new Date(deps.now().getTime() + 30_000));
      report.deferred += 1;
      continue;
    }
    try {
      const { data: covered } = await deps.admin
        .from("sync_jobs")
        .select("id")
        .eq("kind", kind)
        .eq("athlete_id", connection.athlete_id)
        .in("status", ["pending", "failed"])
        .neq("id", job.id);
      await sync(connection);
      synced.add(connection.athlete_id);
      await finish([job.id, ...(covered ?? []).map((c) => c.id)]);
      report.done += 1;
    } catch (failure) {
      await recordFailure(deps, provider, job, failure, report);
    } finally {
      await deps.admin.rpc("release_sync_lease", { p_connection: connection.id });
    }
  }
  return report;
}

async function recordFailure(deps: JobDeps, provider: DeviceProvider, job: SyncJob, failure: unknown, report: RunReport) {
  const now = deps.now();
  if (failure instanceof DeviceDeferError) {
    await deps.admin.from("provider_state").upsert({ provider, blocked_until: failure.until.toISOString() }, { onConflict: "provider" });
    // Un report pour quota ne compte pas comme un échec.
    await deps.admin
      .from("sync_jobs")
      .update({ status: "failed", attempts: Math.max(0, job.attempts - 1), run_after: failure.until.toISOString(), last_error: "rate_limited", locked_at: null })
      .eq("id", job.id);
    report.deferred += 1;
    return;
  }
  const reauth = failure instanceof DeviceReauthError;
  const config = failure instanceof DeviceConfigError ? failure : null;
  const dead = reauth || job.attempts >= job.max_attempts;
  const message = failure instanceof Error ? failure.message : "Erreur inconnue.";
  await deps.admin
    .from("sync_jobs")
    .update({
      status: dead ? "dead" : "failed",
      // Réglage du site à corriger : on réessaie rarement.
      run_after: new Date(now.getTime() + (config ? 6 * 3600_000 : backoffDelayMs(job.attempts))).toISOString(),
      last_error: (reauth ? "reauth_required" : message).slice(0, 500),
      locked_at: null,
      ...(dead ? { finished_at: now.toISOString(), payload: {} } : {}),
    })
    .eq("id", job.id);
  if (job.athlete_id && !reauth && (config || dead)) {
    await deps.admin
      .from("external_connections")
      .update({ last_error: config?.code ?? "sync_failed", last_error_at: now.toISOString() })
      .eq("athlete_id", job.athlete_id)
      .eq("provider", provider);
  }
  await deviceLog(deps.admin, provider, {
    level: dead || config ? "error" : "warn",
    event: `${provider}_sync_${dead ? "abandoned" : "retry"}`,
    message: reauth ? `Reconnexion à ${PROVIDER_NAMES[provider]} nécessaire.` : message,
    athleteId: job.athlete_id,
    jobId: job.id,
  });
  report.failed += 1;
}

/** Marque une connexion « à reconnecter » ; `quiet` (déconnexion en cours) : rien à signaler. */
export async function markReauth(admin: AdminClient, provider: DeviceProvider, connection: Pick<DeviceConnection, "id" | "athlete_id">, now: Date, quiet = false) {
  if (quiet) return;
  await admin.from("external_connections").update({ status: "reauth_required", last_error: "reauth_required", last_error_at: now.toISOString() }).eq("id", connection.id);
  await deviceLog(admin, provider, { level: "warn", event: `${provider}_reauth_required`, athleteId: connection.athlete_id });
}
