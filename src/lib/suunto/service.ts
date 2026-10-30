/**
 * Intégration Suunto côté serveur : connexion et déconnexion du compte, envoi des séances
 * prévues sur la montre (guides SuuntoPlus), file de jobs. Comme pour Strava, tout passe par des
 * dépendances explicites (client base « serveur », API, clé, horloge) que les tests remplacent.
 *
 * Ce qui part sur la montre : chaque séance publiée des 14 prochains jours, une partie par guide.
 * Une séance modifiée met son guide à jour (même identifiant chez Suunto), une séance annulée,
 * dépubliée ou sortie de la fenêtre retire le guide. Aucun succès n'est affiché sans la réponse de Suunto.
 */
import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import type { CompatibilityIssue } from "@/lib/export/types";
import { exportContext } from "@/lib/export/session";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { parseWorkout } from "@/lib/workout/schema";
import { SuuntoApi, SuuntoError, type TokenResponse } from "./api";
import { SUUNTO_WINDOW_DAYS, type SuuntoSettings } from "./config";
import { buildGuidePackage } from "./guide";

export interface SuuntoDeps {
  admin: AdminClient;
  api: SuuntoApi;
  key: Buffer;
  settings: SuuntoSettings;
  /** URL publique du site, pour l'adresse de retour OAuth et le lien de chaque guide. */
  siteUrl: string;
  /** Modes sportifs Suunto par discipline (facultatif). */
  activities?: Partial<Record<"run" | "bike" | "swim" | "strength" | "other", number[]>>;
  now: () => Date;
}

/** L'athlète a retiré l'accès, ou ses jetons ne sont plus acceptés : il doit se reconnecter. */
export class SuuntoReauthError extends Error {
  constructor() {
    super("Reconnexion à Suunto nécessaire.");
    this.name = "SuuntoReauthError";
  }
}

type Connection = { id: string; athlete_id: string; status: string };
type SyncJob = {
  id: number;
  kind: string;
  athlete_id: string | null;
  payload: Json;
  attempts: number;
  max_attempts: number;
};

export const redirectUri = (siteUrl: string) => `${siteUrl}/api/suunto/callback`;

export async function logSuunto(
  admin: AdminClient,
  entry: {
    level: "info" | "warn" | "error";
    event: string;
    message?: string;
    athleteId?: string | null;
    jobId?: number | null;
  },
) {
  await admin.from("sync_logs").insert({
    level: entry.level,
    provider: "suunto",
    event: entry.event.slice(0, 80),
    message: entry.message?.slice(0, 500) ?? null,
    athlete_id: entry.athleteId ?? null,
    job_id: entry.jobId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

async function saveTokens(deps: SuuntoDeps, connectionId: string, tokens: TokenResponse) {
  const row = {
    connection_id: connectionId,
    access_token: encryptSecret(tokens.access_token, deps.key, `${connectionId}:access`),
    refresh_token: encryptSecret(tokens.refresh_token, deps.key, `${connectionId}:refresh`),
    expires_at: new Date(deps.now().getTime() + tokens.expires_in * 1000).toISOString(),
    updated_at: deps.now().toISOString(),
  };
  const { error } = await deps.admin.from("oauth_tokens").upsert({ ...row, revision: 1 }, { onConflict: "connection_id" });
  if (error) throw new Error(`Enregistrement des jetons impossible : ${error.message}`);
}

async function markReauth(deps: SuuntoDeps, connection: Connection) {
  await deps.admin
    .from("external_connections")
    .update({
      status: "reauth_required",
      last_error: "reauth_required",
      last_error_at: deps.now().toISOString(),
    })
    .eq("id", connection.id);
  await logSuunto(deps.admin, {
    level: "warn",
    event: "suunto_reauth_required",
    athleteId: connection.athlete_id,
  });
}

/** Jeton d'accès valide, renouvelé s'il expire dans moins de 5 minutes (contrôle de révision contre les doubles renouvellements). */
export async function accessTokenFor(deps: SuuntoDeps, connection: Connection): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row } = await deps.admin
      .from("oauth_tokens")
      .select("access_token, refresh_token, expires_at, revision")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (!row) {
      await markReauth(deps, connection);
      throw new SuuntoReauthError();
    }
    if (new Date(row.expires_at).getTime() - deps.now().getTime() > 5 * 60_000) {
      return decryptSecret(row.access_token, deps.key, `${connection.id}:access`);
    }
    let tokens: TokenResponse;
    try {
      tokens = await deps.api.refresh(decryptSecret(row.refresh_token, deps.key, `${connection.id}:refresh`));
    } catch (error) {
      if (error instanceof SuuntoError && (error.kind === "unauthorized" || error.kind === "bad_request" || error.kind === "forbidden")) {
        if (attempt === 0) continue;
        await markReauth(deps, connection);
        throw new SuuntoReauthError();
      }
      throw error;
    }
    const { data: updated } = await deps.admin
      .from("oauth_tokens")
      .update({
        access_token: encryptSecret(tokens.access_token, deps.key, `${connection.id}:access`),
        refresh_token: encryptSecret(tokens.refresh_token, deps.key, `${connection.id}:refresh`),
        expires_at: new Date(deps.now().getTime() + tokens.expires_in * 1000).toISOString(),
        revision: row.revision + 1,
        updated_at: deps.now().toISOString(),
      })
      .eq("connection_id", connection.id)
      .eq("revision", row.revision)
      .select("revision")
      .maybeSingle();
    if (updated) return tokens.access_token;
    // Un autre serveur a renouvelé entre-temps : on relit son jeton.
  }
  throw new Error("Jeton Suunto indisponible.");
}

async function withToken<T>(deps: SuuntoDeps, connection: Connection, call: (token: string) => Promise<T>): Promise<T> {
  const token = await accessTokenFor(deps, connection);
  try {
    return await call(token);
  } catch (error) {
    if (error instanceof SuuntoError && error.kind === "unauthorized") {
      await markReauth(deps, connection);
      throw new SuuntoReauthError();
    }
    throw error;
  }
}

async function activeConnection(deps: SuuntoDeps, athleteId: string): Promise<Connection | null> {
  const { data } = await deps.admin
    .from("external_connections")
    .select("id, athlete_id, status")
    .eq("athlete_id", athleteId)
    .eq("provider", "suunto")
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Connexion et déconnexion
// ---------------------------------------------------------------------------

export type ConnectResult = { status: "connected"; connectionId: string } | { status: "already_linked" };

export async function connectSuunto(deps: SuuntoDeps, athleteId: string, code: string): Promise<ConnectResult> {
  const tokens = await deps.api.exchangeCode(code, redirectUri(deps.siteUrl));
  // Suunto renvoie le nom d'utilisateur avec le jeton ; à défaut, l'identifiant reste propre à TriCoach.
  const externalId = (tokens.user ?? `tc-${athleteId}`).slice(0, 40);

  const { data: taken } = await deps.admin
    .from("external_connections")
    .select("athlete_id")
    .eq("provider", "suunto")
    .eq("external_athlete_id", externalId)
    .maybeSingle();
  if (taken && taken.athlete_id !== athleteId) return { status: "already_linked" };

  const { data: previous } = await deps.admin
    .from("external_connections")
    .select("id, external_athlete_id")
    .eq("athlete_id", athleteId)
    .eq("provider", "suunto")
    .maybeSingle();
  if (previous && previous.external_athlete_id !== externalId) {
    await deps.admin.from("external_connections").delete().eq("id", previous.id);
  }

  const { data: connection, error } = await deps.admin
    .from("external_connections")
    .upsert(
      {
        athlete_id: athleteId,
        provider: "suunto",
        external_athlete_id: externalId,
        scopes: ["workout", "guides"],
        status: "active",
        connected_at: deps.now().toISOString(),
        last_error: null,
        last_error_at: null,
      },
      { onConflict: "athlete_id,provider" },
    )
    .select("id")
    .single();
  if (error || !connection) throw new Error(`Connexion Suunto non enregistrée : ${error?.message ?? "inconnue"}`);
  await saveTokens(deps, connection.id, tokens);
  await enqueueWindow(deps, athleteId, `connect:${deps.now().getTime()}`);
  await logSuunto(deps.admin, {
    level: "info",
    event: "suunto_connected",
    athleteId,
  });
  return { status: "connected", connectionId: connection.id };
}

/** Retire les guides envoyés (si Suunto répond), puis efface connexion, jetons et jobs. */
export async function disconnectSuunto(deps: SuuntoDeps, athleteId: string): Promise<{ removed: number; failed: number }> {
  const connection = await activeConnection(deps, athleteId);
  if (!connection) return { removed: 0, failed: 0 };
  const { data: guides } = await deps.admin
    .from("suunto_guides")
    .select("id, guide_id")
    .eq("athlete_id", athleteId)
    .neq("status", "removed")
    .not("guide_id", "is", null);
  let removed = 0;
  let failed = 0;
  for (const guide of guides ?? []) {
    try {
      await withToken(deps, connection, (token) => deps.api.deleteGuide(token, guide.guide_id as string));
      removed += 1;
    } catch (error) {
      if (error instanceof SuuntoError && error.kind === "not_found") removed += 1;
      else failed += 1;
    }
  }
  await deps.admin.from("suunto_guides").delete().eq("athlete_id", athleteId);
  await deps.admin.from("external_connections").delete().eq("id", connection.id);
  await deps.admin.from("sync_jobs").delete().eq("athlete_id", athleteId).in("kind", ["suunto_push", "suunto_remove"]).in("status", ["pending", "failed"]);
  await logSuunto(deps.admin, {
    level: "info",
    event: failed ? "suunto_disconnected_guides_left" : "suunto_disconnected",
    athleteId,
    message: failed ? `${failed} guide(s) non retiré(s) chez Suunto.` : undefined,
  });
  return { removed, failed };
}

// ---------------------------------------------------------------------------
// Envoi d'une séance
// ---------------------------------------------------------------------------

export type SegmentPush =
  | {
      segmentIndex: number;
      status: "sent";
      guideId: string;
      issues: CompatibilityIssue[];
    }
  | {
      segmentIndex: number;
      status: "failed";
      error: string;
      issues: CompatibilityIssue[];
    }
  | { segmentIndex: number; status: "removed" };

export type PushResult =
  | { status: "pushed"; segments: SegmentPush[] }
  | {
      status: "removed";
      reason: "cancelled" | "unpublished" | "out_of_window" | "invalid";
    }
  | { status: "skipped"; reason: "not_connected" | "not_found" };

const localDate = (now: Date) => now.toISOString().slice(0, 10);

function windowEnd(now: Date): string {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + SUUNTO_WINDOW_DAYS);
  return localDate(end);
}

async function removeGuides(deps: SuuntoDeps, connection: Connection, sessionId: string) {
  const { data: guides } = await deps.admin.from("suunto_guides").select("id, guide_id").eq("session_id", sessionId).neq("status", "removed");
  for (const guide of guides ?? []) {
    if (guide.guide_id) {
      try {
        await withToken(deps, connection, (token) => deps.api.deleteGuide(token, guide.guide_id as string));
      } catch (error) {
        if (!(error instanceof SuuntoError && error.kind === "not_found")) throw error;
      }
    }
    await deps.admin.from("suunto_guides").update({ status: "removed", last_error: null }).eq("id", guide.id);
  }
}

/** Envoie (ou met à jour, ou retire) les guides d'une séance, selon son état et sa date. */
export async function pushSession(deps: SuuntoDeps, athleteId: string, sessionId: string): Promise<PushResult> {
  const connection = await activeConnection(deps, athleteId);
  if (!connection || connection.status !== "active") return { status: "skipped", reason: "not_connected" };

  const { data: session } = await deps.admin
    .from("planned_sessions")
    .select("id, athlete_id, title, description, nutrition_notes, scheduled_date, state, content, version")
    .eq("id", sessionId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!session) return { status: "skipped", reason: "not_found" };

  const now = deps.now();
  const reason =
    session.state === "cancelled"
      ? "cancelled"
      : session.state !== "published"
        ? "unpublished"
        : session.scheduled_date < localDate(now) || session.scheduled_date > windowEnd(now)
          ? "out_of_window"
          : null;
  if (reason) {
    await removeGuides(deps, connection, sessionId);
    return { status: "removed", reason };
  }
  const workout = parseWorkout(session.content);
  if (!workout.success) {
    await removeGuides(deps, connection, sessionId);
    return { status: "removed", reason: "invalid" };
  }

  const { data: thresholdRows } = await deps.admin.from("athlete_thresholds").select("sport, metric, value, effective_from").eq("athlete_id", athleteId);
  const thresholds = toAthleteThresholds(
    currentThresholds(
      (thresholdRows ?? []).map((r) => ({ ...r, value: Number(r.value) })),
      session.scheduled_date,
    ),
  );
  const context = exportContext(session, thresholds);
  const { data: existing } = await deps.admin.from("suunto_guides").select("segment_index, guide_id, status").eq("session_id", sessionId);
  const byIndex = new Map((existing ?? []).map((g) => [g.segment_index, g]));
  const segments: SegmentPush[] = [];

  for (const [segmentIndex, segment] of workout.data.segments.entries()) {
    const multi = workout.data.segments.length > 1;
    const title = multi ? `${context.title} · ${segmentIndex + 1}/${workout.data.segments.length}` : context.title;
    const pack = buildGuidePackage(segment, {
      title,
      description: context.description,
      date: session.scheduled_date,
      owner: deps.settings.appName,
      url: `${deps.siteUrl}/athlete/calendar?session=${session.id}`,
      externalId: `${session.id}:${segmentIndex}`,
      thresholds,
      activities: deps.activities?.[segment.sport],
    });
    const previous = byIndex.get(segmentIndex);
    const base = {
      session_id: session.id,
      athlete_id: athleteId,
      segment_index: segmentIndex,
      session_version: session.version,
      issues: pack.issues as unknown as NonNullable<Json>,
    };
    if (pack.issues.some((i) => i.severity === "blocking")) {
      const error = pack.issues.find((i) => i.severity === "blocking")?.message ?? "Conversion impossible.";
      await deps.admin.from("suunto_guides").upsert(
        {
          ...base,
          guide_id: previous?.guide_id ?? null,
          status: "failed",
          last_error: error.slice(0, 300),
        },
        { onConflict: "session_id,segment_index" },
      );
      segments.push({
        segmentIndex,
        status: "failed",
        error,
        issues: pack.issues,
      });
      continue;
    }
    try {
      let guideId = previous?.guide_id ?? null;
      if (guideId && previous?.status !== "removed") {
        try {
          await withToken(deps, connection, (token) => deps.api.updateGuide(token, guideId as string, pack.zip));
        } catch (error) {
          // Guide effacé depuis l'appli Suunto : on le recrée.
          if (error instanceof SuuntoError && (error.kind === "not_found" || error.kind === "bad_request")) guideId = null;
          else throw error;
        }
      }
      if (!guideId || previous?.status === "removed") {
        guideId = (await withToken(deps, connection, (token) => deps.api.createGuide(token, pack.zip))).id;
      }
      await deps.admin.from("suunto_guides").upsert(
        {
          ...base,
          guide_id: guideId,
          status: "sent",
          last_error: null,
          sent_at: now.toISOString(),
        },
        { onConflict: "session_id,segment_index" },
      );
      segments.push({
        segmentIndex,
        status: "sent",
        guideId,
        issues: pack.issues,
      });
    } catch (error) {
      if (error instanceof SuuntoReauthError) throw error;
      const message = error instanceof Error ? error.message : "Erreur inconnue.";
      await deps.admin.from("suunto_guides").upsert(
        {
          ...base,
          guide_id: previous?.guide_id ?? null,
          status: "failed",
          last_error: message.slice(0, 300),
        },
        { onConflict: "session_id,segment_index" },
      );
      segments.push({
        segmentIndex,
        status: "failed",
        error: message,
        issues: pack.issues,
      });
      if (error instanceof SuuntoError && error.kind === "rate_limited") throw error;
    }
  }
  // Un enchaînement raccourci : les parties en trop sont retirées.
  for (const guide of existing ?? []) {
    if (guide.segment_index >= workout.data.segments.length && guide.status !== "removed") {
      if (guide.guide_id) {
        try {
          await withToken(deps, connection, (token) => deps.api.deleteGuide(token, guide.guide_id as string));
        } catch (error) {
          if (!(error instanceof SuuntoError && error.kind === "not_found")) throw error;
        }
      }
      await deps.admin.from("suunto_guides").update({ status: "removed" }).eq("session_id", sessionId).eq("segment_index", guide.segment_index);
      segments.push({ segmentIndex: guide.segment_index, status: "removed" });
    }
  }
  const failed = segments.some((s) => s.status === "failed");
  await deps.admin
    .from("external_connections")
    .update({
      last_sync_at: now.toISOString(),
      last_error: failed ? "push_failed" : null,
      last_error_at: failed ? now.toISOString() : null,
    })
    .eq("id", connection.id);
  return { status: "pushed", segments };
}

// ---------------------------------------------------------------------------
// File de jobs
// ---------------------------------------------------------------------------

/** Met en file l'envoi de chaque séance de la fenêtre dont le guide manque ou est périmé. */
export async function enqueueWindow(deps: SuuntoDeps, athleteId: string, reason: string): Promise<number> {
  const { data, error } = await deps.admin.rpc("suunto_sessions_to_push", {
    p_athlete: athleteId,
    p_today: localDate(deps.now()),
    p_days: SUUNTO_WINDOW_DAYS,
  });
  if (error) throw new Error(`Séances à envoyer illisibles : ${error.message}`);
  let queued = 0;
  for (const row of data ?? []) {
    if (row.sent_version !== null && row.sent_version >= row.session_version) continue;
    const { error: queueError } = await deps.admin.from("sync_jobs").upsert(
      {
        kind: "suunto_push",
        athlete_id: athleteId,
        payload: { session_id: row.session_id },
        dedupe_key: `suunto:push:${row.session_id}:v${row.session_version}:${reason}`,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (queueError) throw new Error(`Envoi non mis en file : ${queueError.message}`);
    queued += 1;
  }
  return queued;
}

/** Tâche quotidienne : chaque athlète relié reçoit les séances entrées dans la fenêtre. */
export async function enqueueDailySuunto(deps: SuuntoDeps): Promise<number> {
  const day = localDate(deps.now());
  const { data: connections } = await deps.admin.from("external_connections").select("athlete_id").eq("provider", "suunto").eq("status", "active");
  for (const connection of connections ?? []) await enqueueWindow(deps, connection.athlete_id, `daily:${day}`);
  return connections?.length ?? 0;
}

/** Traite un job « suunto_push » ou « suunto_remove » (appelé par la file commune des jobs). */
export async function handleSuuntoJob(deps: SuuntoDeps, job: SyncJob): Promise<void> {
  const payload = (job.payload ?? {}) as {
    session_id?: string;
    guide_ids?: string[];
  };
  if (job.kind === "suunto_push") {
    if (!job.athlete_id || !payload.session_id) return;
    const result = await pushSession(deps, job.athlete_id, payload.session_id);
    if (result.status === "pushed" && result.segments.some((s) => s.status === "failed")) {
      throw new Error(result.segments.flatMap((s) => (s.status === "failed" ? [s.error] : [])).join(" ; "));
    }
    return;
  }
  if (job.kind === "suunto_remove") {
    if (!job.athlete_id) return;
    const connection = await activeConnection(deps, job.athlete_id);
    if (!connection || connection.status !== "active") return;
    for (const guideId of payload.guide_ids ?? []) {
      try {
        await withToken(deps, connection, (token) => deps.api.deleteGuide(token, guideId));
      } catch (error) {
        if (!(error instanceof SuuntoError && error.kind === "not_found")) throw error;
      }
    }
  }
}

export const isSuuntoJob = (kind: string) => kind === "suunto_push" || kind === "suunto_remove";
