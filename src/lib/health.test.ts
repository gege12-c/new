import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("état de la production", () => {
  it("signale une configuration Supabase absente sans appeler le réseau", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const fetcher = reply(200, {});
    const report = await checkHealth(fetcher);
    expect(report).toMatchObject({ ok: false, supabase: "not_configured", auth: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("lit les réglages publics d'authentification avec la clé publique", async () => {
    configure();
    const fetcher = reply(200, { disable_signup: false, mailer_autoconfirm: false, external: { email: true } });
    const report = await checkHealth(fetcher);
    expect(report).toMatchObject({ ok: true, supabase: "ok", auth: { signup: "enabled", emailConfirmation: "required" } });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://example.supabase.co/auth/v1/settings");
    expect(init.headers).toEqual({ apikey: "sb_publishable_test" });
  });

  it("indique une confirmation d'email désactivée", async () => {
    configure();
    const report = await checkHealth(reply(200, { disable_signup: false, mailer_autoconfirm: true }));
    expect(report.auth).toEqual({ signup: "enabled", emailConfirmation: "disabled" });
  });

  it("distingue clé refusée, service injoignable et réponse inattendue", async () => {
    configure();
    expect((await checkHealth(reply(401, { message: "Invalid API key" }))).supabase).toBe("invalid_key");
    expect((await checkHealth(reply(500, {}))).supabase).toBe("unexpected_response");
    expect((await checkHealth(reply(200, { unrelated: true }))).supabase).toBe("unexpected_response");
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await checkHealth(offline)).supabase).toBe("unreachable");
  });
});
