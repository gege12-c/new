/**
 * Client de l'API Strava v3 (sans état). Le jeton passe toujours par l'en-tête Authorization
 * (obligatoire au 1er juin 2027), la révocation par /oauth/revoke (seule méthode à cette date).
 * Les quotas lus dans chaque réponse sont transmis à `onRateLimit` pour être partagés entre serveurs.
 */
import { z } from "zod";
import {
  PushSubscriptionSchema,
  SummaryActivitySchema,
  TokenResponseSchema,
  type PushSubscription,
  type SummaryActivity,
  type TokenResponse,
} from "./schemas";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface StravaEndpoints {
  /** Par défaut https://www.strava.com/api/v3 ; https://api-v3.strava.com à partir du 4 janvier 2027. */
  apiBaseUrl: string;
  /** Par défaut https://www.strava.com/oauth */
  oauthBaseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Quotas : fenêtre de 15 minutes (remise à zéro aux quarts d'heure) et journée (minuit UTC). */
export interface RateLimitSnapshot {
  limit15: number;
  usage15: number;
  limitDay: number;
  usageDay: number;
  readLimit15: number | null;
  readUsage15: number | null;
  readLimitDay: number | null;
  readUsageDay: number | null;
}

export type StravaErrorKind = "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "bad_request" | "server" | "network" | "invalid_response";

export class StravaError extends Error {
  constructor(
    readonly kind: StravaErrorKind,
    message: string,
    readonly status?: number,
    /** Pour rate_limited : instant à partir duquel réessayer. */
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = "StravaError";
  }
}

function pair(value: string | null): [number, number] | null {
  if (!value) return null;
  const [a, b] = value.split(",").map((v) => Number(v.trim()));
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

export function parseRateLimits(headers: Headers): RateLimitSnapshot | null {
  const limit = pair(headers.get("x-ratelimit-limit"));
  const usage = pair(headers.get("x-ratelimit-usage"));
  if (!limit || !usage) return null;
  const readLimit = pair(headers.get("x-readratelimit-limit"));
  const readUsage = pair(headers.get("x-readratelimit-usage"));
  return {
    limit15: limit[0],
    limitDay: limit[1],
    usage15: usage[0],
    usageDay: usage[1],
    readLimit15: readLimit?.[0] ?? null,
    readLimitDay: readLimit?.[1] ?? null,
    readUsage15: readUsage?.[0] ?? null,
    readUsageDay: readUsage?.[1] ?? null,
  };
}

/** Début du prochain quart d'heure (0, 15, 30, 45) et prochain minuit UTC. */
export function nextQuarterHour(now: Date): Date {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(Math.floor(now.getUTCMinutes() / 15) * 15 + 15);
  return next;
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Faut-il attendre avant la prochaine requête ? On garde une marge pour les actions des
 * utilisateurs (connexion, synchronisation manuelle) : 10 % de la fenêtre de 15 minutes, 5 % de la journée.
 */
export function quotaWaitUntil(snapshot: RateLimitSnapshot | null, now: Date): Date | null {
  if (!snapshot) return null;
  const over = (usage: number | null, limit: number | null, share: number) =>
    usage !== null && limit !== null && limit > 0 && usage >= limit - Math.max(1, Math.floor(limit * share));
  if (over(snapshot.usageDay, snapshot.limitDay, 0.05) || over(snapshot.readUsageDay, snapshot.readLimitDay, 0.05)) {
    return nextUtcMidnight(now);
  }
  if (over(snapshot.usage15, snapshot.limit15, 0.1) || over(snapshot.readUsage15, snapshot.readLimit15, 0.1)) {
    return nextQuarterHour(now);
  }
  return null;
}

export class StravaApi {
  constructor(
    private readonly endpoints: StravaEndpoints,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly onRateLimit?: (snapshot: RateLimitSnapshot) => void | Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
    } catch {
      throw new StravaError("network", "Strava ne répond pas.");
    }
    const snapshot = parseRateLimits(response.headers);
    if (snapshot) await this.onRateLimit?.(snapshot);
    if (response.ok) return response;

    const status = response.status;
    if (status === 429) {
      const now = this.now();
      const retryAt = snapshot && snapshot.usageDay >= snapshot.limitDay ? nextUtcMidnight(now) : nextQuarterHour(now);
      throw new StravaError("rate_limited", "Quota de requêtes Strava atteint.", status, retryAt);
    }
    if (status === 401) throw new StravaError("unauthorized", "Autorisation Strava refusée ou expirée.", status);
    if (status === 403) throw new StravaError("forbidden", "Accès refusé par Strava.", status);
    if (status === 404) throw new StravaError("not_found", "Introuvable chez Strava.", status);
    if (status >= 500) throw new StravaError("server", `Strava est indisponible (${status}).`, status);
    throw new StravaError("bad_request", `Requête refusée par Strava (${status}).`, status);
  }

  private async json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new StravaError("invalid_response", "Réponse Strava illisible.");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new StravaError("invalid_response", "Réponse Strava inattendue.");
    return parsed.data;
  }

  private form(values: Record<string, string>): RequestInit {
    return {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(values).toString(),
    };
  }

  /** Échange le code reçu au retour de l'autorisation contre les jetons. */
  async exchangeCode(code: string): Promise<TokenResponse> {
    const response = await this.request(
      `${this.endpoints.oauthBaseUrl}/token`,
      this.form({ client_id: this.endpoints.clientId, client_secret: this.endpoints.clientSecret, code, grant_type: "authorization_code" }),
    );
    return this.json(response, TokenResponseSchema);
  }

  /** Nouveau jeton d'accès. Le jeton de rafraîchissement peut changer : toujours garder le dernier. */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    const response = await this.request(
      `${this.endpoints.oauthBaseUrl}/token`,
      this.form({
        client_id: this.endpoints.clientId,
        client_secret: this.endpoints.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    );
    return this.json(response, TokenResponseSchema);
  }

  /** Révoque l'accès de l'application pour cet athlète (les deux jetons sont invalidés). */
  async revoke(token: string, hint: "access_token" | "refresh_token"): Promise<void> {
    const basic = Buffer.from(`${this.endpoints.clientId}:${this.endpoints.clientSecret}`).toString("base64");
    const init = this.form({ token, token_type_hint: hint });
    await this.request(`${this.endpoints.oauthBaseUrl}/revoke`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Basic ${basic}` },
    });
  }

  private bearer(accessToken: string): RequestInit {
    return { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } };
  }

  async getActivity(accessToken: string, id: string): Promise<SummaryActivity> {
    const response = await this.request(`${this.endpoints.apiBaseUrl}/activities/${encodeURIComponent(id)}`, this.bearer(accessToken));
    return this.json(response, SummaryActivitySchema);
  }

  /** Activités commencées entre deux instants (secondes Unix), page par page. */
  async listActivities(accessToken: string, options: { after: number; before?: number; page: number; perPage: number }): Promise<SummaryActivity[]> {
    const params = new URLSearchParams({ after: String(options.after), page: String(options.page), per_page: String(options.perPage) });
    if (options.before) params.set("before", String(options.before));
    const response = await this.request(`${this.endpoints.apiBaseUrl}/athlete/activities?${params}`, this.bearer(accessToken));
    return this.json(response, z.array(SummaryActivitySchema));
  }

  /** Vérifie qu'un jeton est encore accepté (une requête légère). */
  async getAthlete(accessToken: string): Promise<{ id: number }> {
    const response = await this.request(`${this.endpoints.apiBaseUrl}/athlete`, this.bearer(accessToken));
    return this.json(response, z.object({ id: z.number().int() }));
  }

  async listSubscriptions(): Promise<PushSubscription[]> {
    const params = new URLSearchParams({ client_id: this.endpoints.clientId, client_secret: this.endpoints.clientSecret });
    const response = await this.request(`${this.endpoints.apiBaseUrl}/push_subscriptions?${params}`, { method: "GET", headers: { accept: "application/json" } });
    return this.json(response, z.array(PushSubscriptionSchema));
  }

  /** Strava valide aussitôt l'adresse par un GET (hub.challenge) avant de répondre. */
  async createSubscription(callbackUrl: string, verifyToken: string): Promise<{ id: number }> {
    const response = await this.request(
      `${this.endpoints.apiBaseUrl}/push_subscriptions`,
      this.form({
        client_id: this.endpoints.clientId,
        client_secret: this.endpoints.clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      }),
    );
    return this.json(response, z.object({ id: z.number().int() }));
  }

  async deleteSubscription(id: number): Promise<void> {
    const params = new URLSearchParams({ client_id: this.endpoints.clientId, client_secret: this.endpoints.clientSecret });
    await this.request(`${this.endpoints.apiBaseUrl}/push_subscriptions/${id}?${params}`, { method: "DELETE" });
  }
}
