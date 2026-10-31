/**
 * Client de l'API Cloud de Suunto (sans état) : OAuth 2.0 et guides SuuntoPlus.
 *
 * - OAuth : /authorize puis /token (authentification « Basic » de l'application) ; les jetons de
 *   renouvellement changent à chaque usage (l'ancien ne sert plus).
 * - Guides : POST /v2/guides/files (archive zip), PUT et DELETE /v2/guides/files/{id},
 *   GET /v2/guides/items (liste paginée). En-têtes : Authorization et Ocp-Apim-Subscription-Key.
 * - La passerelle de Suunto répond 401 pour trois cas que seul le corps distingue : jeton refusé,
 *   quota dépassé (« RateLimitExceeded »), service hors de l'abonnement (« OperationNotFound »).
 *   Un quota n'est donc jamais pris pour une autorisation retirée.
 */
import { z } from "zod";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface SuuntoEndpoints {
  apiBaseUrl: string;
  oauthBaseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
}

export type SuuntoErrorKind =
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "rate_limited"
  | "server"
  | "network"
  | "invalid_response";

export class SuuntoError extends Error {
  constructor(
    readonly kind: SuuntoErrorKind,
    message: string,
    readonly status?: number,
    /** Pour rate_limited : instant à partir duquel réessayer. */
    readonly retryAt?: Date,
    /** Corps de la réponse, abrégé (journal technique seulement). */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SuuntoError";
  }
}

export interface SuuntoTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  /** Nom d'utilisateur Suunto : identifie le compte relié. */
  user: string | null;
}

export interface RemoteGuide {
  id: string;
  externalId: string | null;
  owner: string | null;
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().optional(),
  user: z.string().min(1).max(100).optional(),
});

const PAGE = 50;
const MAX_PAGES = 20;

/** Liste renvoyée nue ou dans une enveloppe (payload, items…). */
function rowsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const key of ["payload", "items", "guides", "data"]) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function idOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const nested = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : null;
  const id = record.id ?? record.guideId ?? nested?.id ?? nested?.guideId;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export class SuuntoApi {
  constructor(
    private readonly endpoints: SuuntoEndpoints,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
    } catch {
      throw new SuuntoError("network", "Suunto ne répond pas.");
    }
  }

  private async failure(response: Response, what: string): Promise<SuuntoError> {
    const body = (await response.text().catch(() => "")).slice(0, 500);
    const status = response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    const retryAt = new Date(this.now().getTime() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 120_000));
    if (status === 429 || (status === 401 && /RateLimitExceeded/i.test(body))) {
      return new SuuntoError("rate_limited", `${what} : quota de Suunto atteint.`, status, retryAt, body);
    }
    if (status === 401 && /OperationNotFound/i.test(body)) {
      return new SuuntoError("unavailable", `${what} : service absent de l'abonnement Suunto.`, status, undefined, body);
    }
    if (status === 401) return new SuuntoError("unauthorized", `${what} : accès refusé par Suunto.`, status, undefined, body);
    if (status === 403) return new SuuntoError("forbidden", `${what} : clé d'abonnement refusée par Suunto.`, status, undefined, body);
    if (status === 404) return new SuuntoError("not_found", `${what} : introuvable chez Suunto.`, status, undefined, body);
    if (status === 409) return new SuuntoError("conflict", `${what} : déjà présent chez Suunto.`, status, undefined, body);
    if (status >= 400 && status < 500) return new SuuntoError("bad_request", `${what} : refusé par Suunto (${status}).`, status, undefined, body);
    return new SuuntoError("server", `${what} : erreur de Suunto (${status}).`, status, undefined, body);
  }

  private async api(path: string, token: string, init: RequestInit = {}, what = "Appel à Suunto"): Promise<Response> {
    const response = await this.send(`${this.endpoints.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": this.endpoints.subscriptionKey,
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw await this.failure(response, what);
    return response;
  }

  private async json(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new SuuntoError("invalid_response", "Réponse de Suunto illisible.", response.status);
    }
  }

  // -------------------------------------------------------------------------
  // OAuth 2.0
  // -------------------------------------------------------------------------

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL(`${this.endpoints.oauthBaseUrl}/authorize`);
    url.search = new URLSearchParams({ response_type: "code", client_id: this.endpoints.clientId, redirect_uri: redirectUri, state }).toString();
    return url.toString();
  }

  private async token(params: Record<string, string>, previousRefresh?: string): Promise<SuuntoTokens> {
    const basic = Buffer.from(`${this.endpoints.clientId}:${this.endpoints.clientSecret}`).toString("base64");
    const response = await this.send(`${this.endpoints.oauthBaseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}`, Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    if (!response.ok) {
      const error = await this.failure(response, "Jetons Suunto");
      // Code ou jeton de renouvellement refusé : l'autorisation n'est plus valable.
      throw error.kind === "bad_request" ? new SuuntoError("unauthorized", error.message, error.status, undefined, error.detail) : error;
    }
    const parsed = TokenSchema.safeParse(await this.json(response));
    if (!parsed.success) throw new SuuntoError("invalid_response", "Jetons Suunto illisibles.", response.status);
    const refreshToken = parsed.data.refresh_token ?? previousRefresh;
    if (!refreshToken) throw new SuuntoError("invalid_response", "Suunto n'a pas fourni de jeton de renouvellement.", response.status);
    return {
      accessToken: parsed.data.access_token,
      refreshToken,
      expiresAt: new Date(this.now().getTime() + (parsed.data.expires_in ?? 3600) * 1000),
      user: parsed.data.user ?? null,
    };
  }

  exchangeCode(code: string, redirectUri: string): Promise<SuuntoTokens> {
    return this.token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  }

  refresh(refreshToken: string): Promise<SuuntoTokens> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken);
  }

  // -------------------------------------------------------------------------
  // Guides
  // -------------------------------------------------------------------------

  /** Tous les guides du compte (toutes origines), page par page. */
  async listGuides(token: string): Promise<RemoteGuide[]> {
    const all: RemoteGuide[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ offset: String(page * PAGE), limit: String(PAGE) });
      const rows = rowsOf(await this.json(await this.api(`/v2/guides/items?${query}`, token, {}, "Liste des guides")));
      for (const row of rows) {
        const id = idOf(row);
        if (!id) continue;
        const record = row as Record<string, unknown>;
        all.push({
          id,
          externalId: typeof record.externalId === "string" ? record.externalId : null,
          owner: typeof record.owner === "string" ? record.owner : null,
        });
      }
      if (rows.length < PAGE) break;
    }
    return all;
  }

  /** Crée un guide ; renvoie son identifiant quand Suunto le donne dans la réponse. */
  async createGuide(token: string, zip: Uint8Array): Promise<string | null> {
    const response = await this.api(
      "/v2/guides/files",
      token,
      { method: "POST", headers: { "Content-Type": "application/zip" }, body: Buffer.from(zip) },
      "Envoi du guide",
    );
    return idOf(await this.json(response));
  }

  async updateGuide(token: string, id: string, zip: Uint8Array): Promise<void> {
    await this.api(
      `/v2/guides/files/${encodeURIComponent(id)}`,
      token,
      { method: "PUT", headers: { "Content-Type": "application/zip" }, body: Buffer.from(zip) },
      "Mise à jour du guide",
    );
  }

  /** Retire un guide ; un guide déjà absent compte comme retiré. */
  async deleteGuide(token: string, id: string): Promise<void> {
    try {
      await this.api(`/v2/guides/files/${encodeURIComponent(id)}`, token, { method: "DELETE" }, "Retrait du guide");
    } catch (error) {
      if (error instanceof SuuntoError && error.kind === "not_found") return;
      throw error;
    }
  }
}
