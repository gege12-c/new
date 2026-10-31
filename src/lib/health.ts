import { z } from "zod";
import { stravaSettings, tokenEncryptionKey } from "@/lib/strava/config";
import { supabaseEnv } from "@/lib/supabase/env";
import { LATEST_MIGRATION } from "@/lib/supabase/schema-version";
import { suuntoSettings } from "@/lib/suunto/config";

/**
 * Production health check: proves that the deployed Supabase URL and key are valid
 * and reports the public auth settings that decide whether sign-up works, whether the
 * database has every migration of this deployment, and which server features are
 * configured (presence only, never a value). Everything returned here is either public
 * (readable with the publishable key) or a yes/no about configuration.
 */

/** Subset of Supabase Auth’s public settings (`GET /auth/v1/settings`). */
const AuthSettingsSchema = z.object({
  disable_signup: z.boolean(),
  mailer_autoconfirm: z.boolean(),
});

export type SupabaseStatus = "ok" | "not_configured" | "invalid_key" | "unreachable" | "unexpected_response";

/** current: every migration applied; update_pending: supabase/production/pending.sql still to run. */
export type DatabaseStatus = "current" | "update_pending" | "unknown";

export type ServerFeatures = {
  /** SUPABASE_SECRET_KEY: job queue, Strava and watch delivery. */
  serverKey: boolean;
  /** TOKEN_ENCRYPTION_KEY (valid): linked accounts (Strava, intervals.icu, Suunto). */
  encryption: boolean;
  /** CRON_SECRET: daily task. */
  cron: boolean;
  strava: boolean;
  suunto: boolean;
};

export type HealthReport = {
  ok: boolean;
  supabase: SupabaseStatus;
  auth: { signup: "enabled" | "disabled"; emailConfirmation: "required" | "disabled" } | null;
  database: DatabaseStatus;
  /** Migration this deployment expects. */
  expectedSchema: string;
  features: ServerFeatures;
  region: string | null;
  commit: string | null;
};

function serverFeatures(): ServerFeatures {
  const has = (name: string) => Boolean(process.env[name]?.trim());
  return {
    serverKey: has("SUPABASE_SECRET_KEY") || has("SUPABASE_SERVICE_ROLE_KEY"),
    encryption: tokenEncryptionKey() !== null,
    cron: (process.env.CRON_SECRET?.trim().length ?? 0) >= 16,
    strava: stravaSettings() !== null,
    suunto: suuntoSettings() !== null,
  };
}

/** Last migration recorded by Supabase, read through a public function added with the schema. */
async function databaseStatus(fetcher: Fetcher, url: string, key: string): Promise<DatabaseStatus> {
  try {
    const response = await fetcher(new URL("/rest/v1/rpc/schema_version", url), {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // The function itself arrives with the update: missing means the update is still to run.
    if (response.status === 404) return "update_pending";
    if (!response.ok) return "unknown";
    const version = await response.json().catch(() => null);
    if (typeof version !== "string" || !/^\d{14}$/.test(version)) return "unknown";
    return version >= LATEST_MIGRATION ? "current" : "update_pending";
  } catch {
    return "unknown";
  }
}

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5000;

export async function checkHealth(fetcher: Fetcher = fetch): Promise<HealthReport> {
  const runtime = {
    expectedSchema: LATEST_MIGRATION,
    features: serverFeatures(),
    region: process.env.VERCEL_REGION ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
  const failure = (supabase: SupabaseStatus): HealthReport => ({ ok: false, supabase, auth: null, database: "unknown", ...runtime });

  const env = supabaseEnv();
  if (!env) return failure("not_configured");
  let endpoint: URL;
  try {
    endpoint = new URL("/auth/v1/settings", env.url);
  } catch {
    return failure("not_configured");
  }

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: { apikey: env.key },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return failure("unreachable");
  }
  if (response.status === 401 || response.status === 403) return failure("invalid_key");
  if (!response.ok) return failure("unexpected_response");

  const settings = AuthSettingsSchema.safeParse(await response.json().catch(() => null));
  if (!settings.success) return failure("unexpected_response");
  return {
    ok: true,
    supabase: "ok",
    auth: {
      signup: settings.data.disable_signup ? "disabled" : "enabled",
      emailConfirmation: settings.data.mailer_autoconfirm ? "disabled" : "required",
    },
    database: await databaseStatus(fetcher, env.url, env.key),
    ...runtime,
  };
}
