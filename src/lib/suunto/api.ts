/**
 * Client de l'API Cloud de Suunto (sans état) : OAuth 2.0 et guides SuuntoPlus.
 *
 * Références (APIZone, apizone.suunto.com) :
 * - OAuth : /oauth/authorize (code), /oauth/token (échange et renouvellement, identifiants de
 *   l'application en authentification Basic) ;
 * - guides : POST /v2/guides/files (création, corps = ZIP guide.json + manifest.json + icon.png),
 *   PUT /v2/guides/files/{id} (mise à jour), DELETE /v2/guides/files/{id}, GET /v2/guides/items ;
 * - chaque appel porte le jeton (Bearer) et la clé d'abonnement (Ocp-Apim-Subscription-Key).
 */
import { z } from "zod";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface SuuntoEndpoints {
  /** Par défaut https://cloudapi.suunto.com */
  apiBaseUrl: string;
  /** Par défaut https://cloudapi-oauth.suunto.com/oauth */
  oauthBaseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
}

export type SuuntoErrorKind = "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "bad_request" | "server" | "network" | "invalid_response";

export class SuuntoError extends Error {
  constructor(
    readonly kind: SuuntoErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = "SuuntoError";
  }
}

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive().default(3600),
  /** Nom d'utilisateur Suunto, renvoyé avec le jeton. */
  user: z.string().min(1).max(40).optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const GuideCreatedSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough();
const GuideItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().optional(),
  })
  .passthrough();

export interface GuideItem {
  id: string;
  name?: string;
}

function kindFor(status: number): SuuntoErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

function explain(status: number, body: string): string {
  if (status === 401) return "Suunto a refusé le jeton d'accès.";
  if (status === 403) return "Suunto a refusé l'accès : clé d'abonnement ou abonnement à l'API en cause.";
  if (status === 404) return "Ressource introuvable chez Suunto.";
  if (status === 429) return "Quota Suunto atteint.";
  if (status === 400 && /owner/i.test(body)) return "Suunto a refusé le guide : le propriétaire (owner) doit être le nom exact de l'application sur l'APIZone.";
  return `Suunto a répondu ${status}${body ? ` : ${body.replace(/\s+/g, " ").slice(0, 160)}` : ""}.`;
}

export class SuuntoApi {
  constructor(
    private readonly endpoints: SuuntoEndpoints,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SuuntoError("network", "Suunto ne répond pas.");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryAfter = Number(response.headers.get("retry-after"));
      const retryAt =
        response.status === 429 ? new Date(this.now().getTime() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1000) : undefined;
      throw new SuuntoError(kindFor(response.status), explain(response.status, body), response.status, retryAt);
    }
    return response;
  }

  private async json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new SuuntoError("invalid_response", "Réponse de Suunto illisible.");
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new SuuntoError("invalid_response", "Réponse de Suunto inattendue.");
    return parsed.data;
  }

  private headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": this.endpoints.subscriptionKey,
      Accept: "application/json",
      ...extra,
    };
  }

  // ---------- OAuth ----------

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL(`${this.endpoints.oauthBaseUrl}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.endpoints.clientId,
      redirect_uri: redirectUri,
      state,
    }).toString();
    return url.toString();
  }

  private async token(params: Record<string, string>): Promise<TokenResponse> {
    const basic = Buffer.from(`${this.endpoints.clientId}:${this.endpoints.clientSecret}`).toString("base64");
    const response = await this.request(`${this.endpoints.oauthBaseUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams(params).toString(),
    });
    return this.json(response, TokenResponseSchema);
  }

  exchangeCode(code: string, redirectUri: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
  }

  refresh(refreshToken: string) {
    return this.token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  // ---------- Guides ----------

  async createGuide(token: string, zip: Uint8Array): Promise<{ id: string }> {
    const response = await this.request(`${this.endpoints.apiBaseUrl}/v2/guides/files`, {
      method: "POST",
      headers: this.headers(token, { "Content-Type": "application/zip" }),
      body: new Uint8Array(zip) as unknown as BodyInit,
    });
    return this.json(response, GuideCreatedSchema);
  }

  async updateGuide(token: string, guideId: string, zip: Uint8Array): Promise<void> {
    await this.request(`${this.endpoints.apiBaseUrl}/v2/guides/files/${encodeURIComponent(guideId)}`, {
      method: "PUT",
      headers: this.headers(token, { "Content-Type": "application/zip" }),
      body: new Uint8Array(zip) as unknown as BodyInit,
    });
  }

  async deleteGuide(token: string, guideId: string): Promise<void> {
    await this.request(`${this.endpoints.apiBaseUrl}/v2/guides/files/${encodeURIComponent(guideId)}`, {
      method: "DELETE",
      headers: this.headers(token),
    });
  }

  async listGuides(token: string): Promise<GuideItem[]> {
    const response = await this.request(`${this.endpoints.apiBaseUrl}/v2/guides/items`, { method: "GET", headers: this.headers(token) });
    const data = await this.json(response, z.unknown());
    const list = Array.isArray(data) ? data : ((data as Record<string, unknown> | null)?.items ?? (data as Record<string, unknown> | null)?.guides ?? []);
    if (!Array.isArray(list)) return [];
    return list.map((item) => GuideItemSchema.safeParse(item)).flatMap((r) => (r.success ? [{ id: r.data.id, name: r.data.name }] : []));
  }
}
