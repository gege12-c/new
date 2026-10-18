/**
 * Faux Strava, pour les tests uniquement : OAuth (code, jetons qui expirent et tournent, révocation),
 * activités, abonnement webhook (avec validation de l'adresse), en-têtes de quota.
 * Données entièrement fictives : aucune activité réelle n'est utilisée ni transmise.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface FakeActivity {
  id: number;
  name?: string;
  sport_type?: string;
  start_date: string;
  start_date_local: string;
  timezone?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  average_heartrate?: number;
  average_watts?: number;
}

interface FakeAthlete {
  id: number;
  firstname: string;
  lastname: string;
  activities: Map<number, FakeActivity>;
  access: Map<string, number>; // jeton → expiration (secondes Unix)
  refreshToken: string | null;
  authorized: boolean;
}

export class FakeStrava {
  readonly clientId = "4242";
  readonly clientSecret = "fake-client-secret";
  readonly athletes = new Map<number, FakeAthlete>();
  readonly codes = new Map<string, { athleteId: number; scope: string }>();
  subscriptions: { id: number; callback_url: string }[] = [];
  /** Durée de vie des jetons d'accès (6 heures chez Strava). */
  tokenTtlSeconds = 21_600;
  usage = { u15: 0, uDay: 0, limit15: 400, limitDay: 4000, r15: 0, rDay: 0, readLimit15: 200, readLimitDay: 2000 };
  readonly calls: string[] = [];
  /** Athlète que la page d'autorisation (navigateur) connecte. */
  authorizeAs: number | null = null;
  private counter = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  addAthlete(id: number, firstname = "Test", lastname = "Athlète") {
    if (!this.athletes.has(id)) {
      this.athletes.set(id, { id, firstname, lastname, activities: new Map(), access: new Map(), refreshToken: null, authorized: true });
    }
    return this.athletes.get(id)!;
  }

  issueCode(athleteId: number, scope = "read,activity:read_all") {
    this.addAthlete(athleteId);
    const code = `code-${athleteId}-${++this.counter}`;
    this.codes.set(code, { athleteId, scope });
    return code;
  }

  addActivity(athleteId: number, activity: FakeActivity) {
    this.addAthlete(athleteId).activities.set(activity.id, activity);
  }

  removeActivity(athleteId: number, activityId: number) {
    this.athletes.get(athleteId)?.activities.delete(activityId);
  }

  /** L'athlète retire l'accès depuis Strava : tous ses jetons cessent de fonctionner. */
  deauthorize(athleteId: number) {
    const athlete = this.athletes.get(athleteId);
    if (!athlete) return;
    athlete.authorized = false;
    athlete.access.clear();
    athlete.refreshToken = null;
  }

  /** Fait expirer tout de suite les jetons d'accès. */
  expireTokens() {
    for (const athlete of this.athletes.values()) for (const token of athlete.access.keys()) athlete.access.set(token, 0);
  }

  private nowSeconds() {
    return Math.floor(this.clock().getTime() / 1000);
  }

  private issueTokens(athlete: FakeAthlete, scope: string) {
    const access = `acc-${athlete.id}-${++this.counter}`;
    const expiresAt = this.nowSeconds() + this.tokenTtlSeconds;
    athlete.access.set(access, expiresAt);
    athlete.refreshToken = `ref-${athlete.id}-${++this.counter}`;
    athlete.authorized = true;
    return {
      token_type: "Bearer",
      access_token: access,
      refresh_token: athlete.refreshToken,
      expires_at: expiresAt,
      expires_in: this.tokenTtlSeconds,
      scope: scope.replace(/,/g, " "),
      athlete: { id: athlete.id, firstname: athlete.firstname, lastname: athlete.lastname },
    };
  }

  private rateHeaders(read: boolean): Record<string, string> {
    return {
      "X-RateLimit-Limit": `${this.usage.limit15},${this.usage.limitDay}`,
      "X-RateLimit-Usage": `${this.usage.u15},${this.usage.uDay}`,
      ...(read
        ? {
            "X-ReadRateLimit-Limit": `${this.usage.readLimit15},${this.usage.readLimitDay}`,
            "X-ReadRateLimit-Usage": `${this.usage.r15},${this.usage.rDay}`,
          }
        : {}),
    };
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  private bearer(init: RequestInit | undefined): FakeAthlete | null {
    const header = new Headers(init?.headers).get("authorization") ?? "";
    const token = header.replace(/^Bearer /, "");
    for (const athlete of this.athletes.values()) {
      const expires = athlete.access.get(token);
      if (expires !== undefined && athlete.authorized && expires > this.nowSeconds()) return athlete;
    }
    return null;
  }

  /** Point d'entrée « fetch » : même interface que l'API réelle. */
  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    this.calls.push(`${method} ${url.pathname}`);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    const path = url.pathname.replace(/^\/api\/v3/, "");

    if (url.pathname.endsWith("/oauth/token") && method === "POST") {
      if (form.get("client_id") !== this.clientId || form.get("client_secret") !== this.clientSecret) return this.json(401, { message: "Bad client" });
      if (form.get("grant_type") === "authorization_code") {
        const grant = this.codes.get(form.get("code") ?? "");
        if (!grant) return this.json(400, { message: "Bad Request", errors: [{ code: "invalid", field: "code" }] });
        this.codes.delete(form.get("code")!);
        return this.json(200, this.issueTokens(this.athletes.get(grant.athleteId)!, grant.scope));
      }
      const athlete = [...this.athletes.values()].find((a) => a.refreshToken && a.refreshToken === form.get("refresh_token"));
      if (!athlete || !athlete.authorized) return this.json(400, { message: "Bad Request", errors: [{ code: "invalid", field: "refresh_token" }] });
      return this.json(200, this.issueTokens(athlete, "read,activity:read_all"));
    }
    if (url.pathname.endsWith("/oauth/revoke") && method === "POST") {
      const expected = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
      if (new Headers(init?.headers).get("authorization") !== expected) return this.json(401, { message: "Unauthorized" });
      const token = form.get("token");
      for (const athlete of this.athletes.values()) {
        if (athlete.refreshToken === token || athlete.access.has(token ?? "")) this.deauthorize(athlete.id);
      }
      return new Response("", { status: 200 });
    }

    // API : quotas comptés et renvoyés comme chez Strava.
    const read = method === "GET";
    this.usage.u15 += 1;
    this.usage.uDay += 1;
    if (read) {
      this.usage.r15 += 1;
      this.usage.rDay += 1;
    }
    const headers = this.rateHeaders(read);
    if (this.usage.u15 > this.usage.limit15 || (read && this.usage.r15 > this.usage.readLimit15)) {
      return this.json(429, { message: "Rate Limit Exceeded" }, headers);
    }

    if (path === "/push_subscriptions") {
      const clientId = method === "GET" ? url.searchParams.get("client_id") : form.get("client_id");
      const secret = method === "GET" ? url.searchParams.get("client_secret") : form.get("client_secret");
      if (clientId !== this.clientId || secret !== this.clientSecret) return this.json(401, { message: "Bad client" }, headers);
      if (method === "GET") return this.json(200, this.subscriptions, headers);
      if (this.subscriptions.length) return this.json(400, { message: "Bad Request", errors: [{ code: "already exists" }] }, headers);
      const callback = form.get("callback_url") ?? "";
      const challenge = `challenge-${++this.counter}`;
      // Comme Strava : validation immédiate de l'adresse de réception.
      const check = await fetch(`${callback}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.challenge": challenge, "hub.verify_token": form.get("verify_token") ?? "" })}`).catch(
        () => null,
      );
      const body = check?.ok ? ((await check.json()) as Record<string, string>) : null;
      if (body?.["hub.challenge"] !== challenge) return this.json(400, { message: "callback url not verifiable" }, headers);
      const subscription = { id: 70 + this.subscriptions.length + 1, callback_url: callback };
      this.subscriptions.push(subscription);
      return this.json(201, { id: subscription.id }, headers);
    }
    const subscriptionMatch = path.match(/^\/push_subscriptions\/(\d+)$/);
    if (subscriptionMatch && method === "DELETE") {
      this.subscriptions = this.subscriptions.filter((s) => s.id !== Number(subscriptionMatch[1]));
      return new Response(null, { status: 204, headers });
    }

    const athlete = this.bearer(init);
    if (!athlete) return this.json(401, { message: "Authorization Error" }, headers);
    if (path === "/athlete") return this.json(200, { id: athlete.id, firstname: athlete.firstname, lastname: athlete.lastname }, headers);
    const activityMatch = path.match(/^\/activities\/(\d+)$/);
    if (activityMatch) {
      const activity = athlete.activities.get(Number(activityMatch[1]));
      return activity ? this.json(200, activity, headers) : this.json(404, { message: "Record Not Found" }, headers);
    }
    if (path === "/athlete/activities") {
      const after = Number(url.searchParams.get("after") ?? 0);
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      const list = [...athlete.activities.values()]
        .filter((a) => Date.parse(a.start_date) / 1000 > after)
        .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));
      return this.json(200, list.slice((page - 1) * perPage, page * perPage), headers);
    }
    return this.json(404, { message: "Unknown fake endpoint" }, headers);
  };

  /** Sert le faux Strava en HTTP (tests de bout en bout) : API, page d'autorisation et pilotage. */
  async serve(port: number): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const body = await readBody(req);
      try {
        if (url.pathname === "/oauth/authorize") {
          // Page d'autorisation : l'athlète désigné accepte aussitôt.
          const athleteId = this.authorizeAs ?? 777001;
          const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
          redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
          redirect.searchParams.set("code", this.issueCode(athleteId, url.searchParams.get("scope") ?? "read"));
          redirect.searchParams.set("scope", url.searchParams.get("scope") ?? "read");
          res.writeHead(302, { location: redirect.toString() }).end();
          return;
        }
        if (url.pathname.startsWith("/__control/")) {
          const payload = body ? JSON.parse(body) : {};
          if (url.pathname === "/__control/authorize-as") this.authorizeAs = payload.athleteId;
          else if (url.pathname === "/__control/activity") this.addActivity(payload.athleteId, payload.activity);
          else if (url.pathname === "/__control/remove-activity") this.removeActivity(payload.athleteId, payload.activityId);
          else if (url.pathname === "/__control/deauthorize") this.deauthorize(payload.athleteId);
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, subscriptions: this.subscriptions }));
          return;
        }
        const response = await this.fetch(url.toString(), {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: body || undefined,
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => (headers[key] = value));
        res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Activité fictive commencée à `start` (heure locale = heure UTC + offset). */
export function fakeActivity(id: number, start: Date, options: { sport?: string; minutes?: number; offsetHours?: number; name?: string } = {}): FakeActivity {
  const offset = (options.offsetHours ?? 2) * 3600_000;
  const local = new Date(start.getTime() + offset).toISOString().replace(/\.\d{3}Z$/, "Z");
  const seconds = (options.minutes ?? 60) * 60;
  return {
    id,
    name: options.name ?? "Activité de test",
    sport_type: options.sport ?? "Run",
    start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    start_date_local: local,
    timezone: "(GMT+02:00) Europe/Paris",
    elapsed_time: seconds + 60,
    moving_time: seconds,
    distance: seconds * 3,
    average_heartrate: 140,
  };
}
