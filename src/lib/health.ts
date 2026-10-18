import { z } from "zod";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * Production health check: proves that the deployed Supabase URL and key are valid
 * and reports the public auth settings that decide whether sign-up works.
 * Everything returned here is already public (readable with the publishable key).
 */

/** Subset of Supabase Auth's public settings (`GET /auth/v1/settings`). */
const AuthSettingsSchema = z.object({
  disable_signup: z.boolean(),
  mailer_autoconfirm: z.boolean(),
});

export type SupabaseStatus = "ok" | "not_configured" | "invalid_key" | "unreachable" | "unexpected_response";

export type HealthReport = {
  ok: boolean;
  supabase: SupabaseStatus;
  auth: { signup: "enabled" | "disabled"; emailConfirmation: "required" | "disabled" } | null;
  region: string | null;
  commit: string | null;
};

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5000;

export async function checkHealth(fetcher: Fetcher = fetch): Promise<HealthReport> {
  const runtime = {
    region: process.env.VERCEL_REGION ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
  const failure = (supabase: SupabaseStatus): HealthReport => ({ ok: false, supabase, auth: null, ...runtime });

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
    ...runtime,
  };
}
