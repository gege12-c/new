import { describe, expect, it } from "vitest";
import { SuuntoApi, SuuntoError, type Fetcher } from "./api";

const endpoints = {
  apiBaseUrl: "https://api.suunto.test",
  oauthBaseUrl: "https://oauth.suunto.test/oauth",
  clientId: "client",
  clientSecret: "secret",
  subscriptionKey: "sub-key",
};
const clock = () => new Date("2026-10-31T08:00:00Z");

/** Réponses servies dans l'ordre ; les requêtes reçues sont gardées pour être vérifiées. */
function scripted(...responses: Response[]) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    seen.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("plus de réponse");
    return next;
  };
  return { api: new SuuntoApi(endpoints, fetcher, clock), seen };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function failure(promise: Promise<unknown>): Promise<SuuntoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SuuntoError) return error;
    throw error;
  }
  throw new Error("échec attendu");
}

describe("client de l'API Suunto", () => {
  it("autorisation : adresse de la page Suunto, échange du code avec l'authentification de l'application", async () => {
    const { api, seen } = scripted(json(200, { access_token: "acc", refresh_token: "ref", expires_in: 86_400, user: "athlete-demo" }));
    expect(api.authorizeUrl("https://tricoach.test/api/suunto/callback", "s1")).toBe(
      "https://oauth.suunto.test/oauth/authorize?response_type=code&client_id=client&redirect_uri=https%3A%2F%2Ftricoach.test%2Fapi%2Fsuunto%2Fcallback&state=s1",
    );
    const tokens = await api.exchangeCode("c0de", "https://tricoach.test/api/suunto/callback");
    expect(tokens).toEqual({ accessToken: "acc", refreshToken: "ref", expiresAt: new Date("2026-11-01T08:00:00Z"), user: "athlete-demo" });
    const [call] = seen;
    expect(call.url).toBe("https://oauth.suunto.test/oauth/token");
    expect(new Headers(call.init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("client:secret").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(String(call.init?.body)))).toEqual({
      grant_type: "authorization_code",
      code: "c0de",
      redirect_uri: "https://tricoach.test/api/suunto/callback",
    });
  });

  it("renouvellement : un jeton refusé veut dire « reconnexion », jamais un faux succès", async () => {
    const refused = scripted(json(400, { error: "invalid_grant" }));
    expect((await failure(refused.api.refresh("old"))).kind).toBe("unauthorized");
    // Sans nouveau jeton de renouvellement dans la réponse, l'ancien reste valable.
    const kept = scripted(json(200, { access_token: "acc2", expires_in: 3600 }));
    expect((await kept.api.refresh("old")).refreshToken).toBe("old");
    const broken = scripted(json(200, { token: "?" }));
    expect((await failure(broken.api.refresh("old"))).kind).toBe("invalid_response");
  });

  it("la passerelle répond 401 pour trois cas : quota, service absent de l'abonnement, jeton refusé", async () => {
    const quota = await failure(scripted(json(401, { error: { code: "RateLimitExceeded" } }, { "retry-after": "90" })).api.listGuides("t"));
    expect(quota.kind).toBe("rate_limited");
    expect(quota.retryAt).toEqual(new Date("2026-10-31T08:01:30Z"));
    expect((await failure(scripted(json(401, { error: { code: "OperationNotFound" } })).api.listGuides("t"))).kind).toBe("unavailable");
    expect((await failure(scripted(json(401, { message: "Invalid token" })).api.listGuides("t"))).kind).toBe("unauthorized");
    expect((await failure(scripted(json(403, {})).api.listGuides("t"))).kind).toBe("forbidden");
    expect((await failure(scripted(json(429, {})).api.listGuides("t"))).retryAt).toEqual(new Date("2026-10-31T08:02:00Z"));
    expect((await failure(scripted(json(503, {})).api.listGuides("t"))).kind).toBe("server");
    const network = new SuuntoApi(endpoints, async () => {
      throw new TypeError("fetch failed");
    });
    expect((await failure(network.listGuides("t"))).kind).toBe("network");
  });

  it("liste des guides : enveloppe « payload », pages de 50, en-têtes d'abonnement et de jeton", async () => {
    const page = (from: number, count: number) =>
      json(200, { error: null, payload: Array.from({ length: count }, (_, i) => ({ id: `g${from + i}`, externalId: i === 0 ? `tricoach-x-${from}` : null, owner: "TriCoach" })), metadata: {} });
    const { api, seen } = scripted(page(0, 50), page(50, 3));
    const guides = await api.listGuides("tok");
    expect(guides).toHaveLength(53);
    expect(guides[0]).toEqual({ id: "g0", externalId: "tricoach-x-0", owner: "TriCoach" });
    expect(seen.map((s) => new URL(s.url).search)).toEqual(["?offset=0&limit=50", "?offset=50&limit=50"]);
    const headers = new Headers(seen[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("ocp-apim-subscription-key")).toBe("sub-key");
    // Liste nue aussi acceptée.
    expect(await scripted(json(200, [{ id: 7, externalId: "tricoach-y-0" }])).api.listGuides("t")).toEqual([{ id: "7", externalId: "tricoach-y-0", owner: null }]);
  });

  it("guides : création (identifiant lu dans la réponse), mise à jour, retrait ; un guide déjà absent compte comme retiré", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const { api, seen } = scripted(json(201, { payload: { id: "g9" } }), json(201, {}), json(200, {}), json(404, {}), json(200, {}));
    expect(await api.createGuide("t", zip)).toBe("g9");
    expect(await api.createGuide("t", zip)).toBeNull();
    await api.updateGuide("t", "g9", zip);
    await api.deleteGuide("t", "g9");
    await api.deleteGuide("t", "g 10");
    expect(seen.map((s) => `${s.init?.method} ${new URL(s.url).pathname}`)).toEqual([
      "POST /v2/guides/files",
      "POST /v2/guides/files",
      "PUT /v2/guides/files/g9",
      "DELETE /v2/guides/files/g9",
      "DELETE /v2/guides/files/g%2010",
    ]);
    expect(new Headers(seen[0].init?.headers).get("content-type")).toBe("application/zip");
    expect((await failure(scripted(json(409, {})).api.createGuide("t", zip))).kind).toBe("conflict");
    const owner = await failure(scripted(json(400, { error: { description: "Guide owner does not match" } })).api.createGuide("t", zip));
    expect(owner.kind).toBe("bad_request");
    expect(owner.detail).toMatch(/owner/);
  });
});
