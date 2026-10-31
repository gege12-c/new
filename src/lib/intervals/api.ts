/**
 * Client de l'API d'intervals.icu (sans état), avec la clé API personnelle de l'athlète.
 *
 * Documentation officielle (forum intervals.icu, « API access to Intervals.icu » et « Uploading
 * planned workouts to Intervals.icu ») : authentification « Basic » (utilisateur API_KEY, mot de
 * passe la clé), athlète 0 = celui de la clé ; création ou mise à jour en lot des séances prévues
 * par identifiant externe (POST /events/bulk?upsert=true), retrait en lot (PUT /events/bulk-delete,
 * les évènements absents sont ignorés) ; activités faites d'une période (GET /activities?oldest&newest :
 * résumés, sans les activités reçues de Strava, qu'intervals.icu ne transmet pas) ; courbes et
 * intervalles d'une activité (spécification OpenAPI d'intervals.icu). Quotas : 429 avec Retry-After.
 */
import { z } from "zod";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export const INTERVALS_DEFAULT_BASE_URL = "https://intervals.icu";

export type IntervalsErrorKind = "unauthorized" | "bad_request" | "rate_limited" | "server" | "network" | "invalid_response";

export class IntervalsError extends Error {
  constructor(
    readonly kind: IntervalsErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAt?: Date,
    /** Corps de la réponse, abrégé (journal technique seulement). */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "IntervalsError";
  }
}

/** Séance prévue, au format des évènements d'intervals.icu. */
export interface IntervalsEvent {
  category: "WORKOUT";
  /** Date locale, à minuit : « 2026-11-02T00:00:00 » (l'API n'accepte pas d'heure). */
  start_date_local: string;
  type: "Ride" | "Run" | "Swim" | "WeightTraining" | "Workout";
  name: string;
  /** Texte de la séance, au format de l'éditeur d'intervals.icu (lu par intervals.icu). */
  description: string;
  external_id: string;
}

const AthleteSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String), name: z.string().nullish() });
const EventSchema = z.object({ id: z.union([z.string(), z.number()]).transform(String), external_id: z.string().nullish() });

export class IntervalsApi {
  constructor(
    private readonly baseUrl: string = INTERVALS_DEFAULT_BASE_URL,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async call(key: string, path: string, init: RequestInit = {}, what = "Appel à intervals.icu"): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/api/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString("base64")}`,
          Accept: "application/json",
          // intervals.icu est derrière Cloudflare, qui peut bloquer les clients sans en-tête de navigateur.
          "User-Agent": "Mozilla/5.0 (compatible; TriCoach/1.0)",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        signal: init.signal ?? AbortSignal.timeout(20_000),
      });
    } catch {
      throw new IntervalsError("network", "intervals.icu ne répond pas.");
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const detail = text.slice(0, 500);
      const status = response.status;
      if (status === 401 || status === 403) throw new IntervalsError("unauthorized", `${what} : clé refusée par intervals.icu.`, status, undefined, detail);
      if (status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const retryAt = new Date(this.now().getTime() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15 * 60_000));
        throw new IntervalsError("rate_limited", `${what} : quota d'intervals.icu atteint.`, status, retryAt, detail);
      }
      if (status >= 400 && status < 500) throw new IntervalsError("bad_request", `${what} : refusé par intervals.icu (${status}).`, status, undefined, detail);
      throw new IntervalsError("server", `${what} : erreur d'intervals.icu (${status}).`, status, undefined, detail);
    }
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new IntervalsError("invalid_response", "Réponse d'intervals.icu illisible.", response.status);
    }
  }

  /** Athlète de la clé : sert à vérifier la clé et à reconnaître le compte. */
  async athlete(key: string): Promise<{ id: string; name: string | null }> {
    const parsed = AthleteSchema.safeParse(await this.call(key, "/athlete/0", {}, "Vérification de la clé"));
    if (!parsed.success) throw new IntervalsError("invalid_response", "Profil intervals.icu illisible.");
    return { id: parsed.data.id, name: parsed.data.name ?? null };
  }

  /** Crée ou met à jour les séances (par identifiant externe) ; renvoie leur identifiant chez intervals.icu. */
  async upsertEvents(key: string, events: IntervalsEvent[]): Promise<Map<string, string>> {
    const body = await this.call(key, "/athlete/0/events/bulk?upsert=true", { method: "POST", body: JSON.stringify(events) }, "Dépôt des séances");
    const rows = z.array(EventSchema).safeParse(body);
    if (!rows.success) throw new IntervalsError("invalid_response", "Réponse du dépôt des séances illisible.");
    return new Map(rows.data.filter((e) => e.external_id).map((e) => [e.external_id!, e.id]));
  }

  /** Activités faites entre deux dates locales (incluses), telles qu'intervals.icu les résume. */
  async activities(key: string, oldest: string, newest: string): Promise<unknown[]> {
    const body = await this.call(
      key,
      `/athlete/0/activities?oldest=${encodeURIComponent(oldest)}&newest=${encodeURIComponent(newest)}`,
      {},
      "Lecture des activités",
    );
    if (!Array.isArray(body)) throw new IntervalsError("invalid_response", "Liste d'activités d'intervals.icu illisible.");
    return body;
  }

  /** Données de forme des jours d'une période (FC au repos, VFC, sommeil, poids…), telles que reçues des montres. */
  async wellness(key: string, oldest: string, newest: string): Promise<unknown[]> {
    const body = await this.call(
      key,
      `/athlete/0/wellness?oldest=${encodeURIComponent(oldest)}&newest=${encodeURIComponent(newest)}`,
      {},
      "Lecture des données de forme",
    );
    if (!Array.isArray(body)) throw new IntervalsError("invalid_response", "Données de forme d'intervals.icu illisibles.");
    return body;
  }

  /**
   * Courbes d'une activité (GET /activity/{id}/streams.json?types=…) : une liste { type, data },
   * une valeur par mesure enregistrée. Spécification OpenAPI d'intervals.icu (ActivityStream).
   */
  async streams(key: string, activityId: string, types: string[]): Promise<unknown> {
    return this.call(key, `/activity/${encodeURIComponent(activityId)}/streams.json?types=${types.map(encodeURIComponent).join(",")}`, {}, "Lecture des courbes");
  }

  /** Intervalles détectés d'une activité (GET /activity/{id}/intervals : { icu_intervals: […] }). */
  async intervals(key: string, activityId: string): Promise<unknown> {
    return this.call(key, `/activity/${encodeURIComponent(activityId)}/intervals`, {}, "Lecture des intervalles");
  }

  /** Retire des séances déposées par TriCoach ; celles qui n'existent plus sont ignorées. */
  async deleteEvents(key: string, externalIds: string[]): Promise<void> {
    if (!externalIds.length) return;
    await this.call(
      key,
      "/athlete/0/events/bulk-delete",
      { method: "PUT", body: JSON.stringify(externalIds.map((external_id) => ({ external_id }))) },
      "Retrait des séances",
    );
  }
}
