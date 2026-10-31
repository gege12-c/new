/**
 * Faux intervals.icu, pour les tests uniquement : clé API personnelle (authentification « Basic »,
 * utilisateur API_KEY), profil de l'athlète, dépôt en lot des séances prévues par identifiant externe
 * (création ou mise à jour), retrait en lot, activités faites d'une période (celles reçues de Strava
 * réduites à une note, comme le fait intervals.icu), courbes et intervalles d'une activité (champs
 * `_streams` et `_intervals` de l'activité de test), réglages par sport (seuils) lus et modifiés,
 * quota (429). Données entièrement fictives.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export interface FakeEvent {
  id: number;
  athlete: string;
  external_id: string;
  category: string;
  start_date_local: string;
  type: string;
  name: string;
  description: string;
  updated: number;
}

const TYPES = new Set(["Ride", "Run", "Swim", "WeightTraining", "Workout"]);

export class FakeIntervals {
  /** Clé API → athlète. */
  readonly keys = new Map<string, string>();
  readonly events = new Map<number, FakeEvent>();
  readonly calls: string[] = [];
  /** Les N prochains appels reçoivent 429 (quota). */
  rateLimitNext = 0;
  /** Séances refusées (422) à cause de leur contenu, par identifiant externe. */
  readonly reject = new Set<string>();
  /** Activités faites, par athlète (format des résumés d'intervals.icu). */
  readonly activities = new Map<string, Record<string, unknown>[]>();
  /** Données de forme par athlète et par jour (champs d'intervals.icu : restingHR, hrv, sleepSecs, weight). */
  readonly wellness = new Map<string, Record<string, unknown>[]>();
  /** Réglages par sport, par athlète (champs d'intervals.icu, unités SI : allure seuil en m/s). */
  readonly sportSettings = new Map<string, Record<string, unknown>[]>();
  /** Simule un intervals.icu qui remplacerait tout le réglage par le corps reçu (filet de sécurité). */
  replaceWholeSettings = false;
  private counter = 1000;

  /** Réglages de l'athlète ; par défaut : FTP 230 W, FC seuil 176, FC max 195, 5:15 /km, CSS 1:40 /100 m. */
  settingsOf(athlete: string): Record<string, unknown>[] {
    if (!this.sportSettings.has(athlete)) {
      this.sportSettings.set(athlete, [
        { id: 101, athlete_id: athlete, types: ["Ride", "VirtualRide"], ftp: 230, lthr: 176, max_hr: 195, threshold_pace: null, power_zones: [55, 75, 90, 105, 120, 150, 999] },
        { id: 102, athlete_id: athlete, types: ["Run", "VirtualRun", "TrailRun"], ftp: null, lthr: 176, max_hr: 195, threshold_pace: 1000 / 315, pace_units: "MINS_KM" },
        { id: 103, athlete_id: athlete, types: ["Swim", "OpenWaterSwim"], ftp: null, lthr: null, max_hr: null, threshold_pace: 1, pace_units: "SECS_100M" },
      ]);
    }
    return this.sportSettings.get(athlete)!;
  }

  addActivity(athlete: string, activity: Record<string, unknown>) {
    this.activities.set(athlete, [...(this.activities.get(athlete) ?? []), activity]);
  }

  removeActivity(athlete: string, id: string) {
    this.activities.set(athlete, (this.activities.get(athlete) ?? []).filter((a) => a.id !== id));
  }

  addKey(key: string, athlete: string) {
    this.keys.set(key, athlete);
  }

  eventsOf(athlete: string) {
    return [...this.events.values()].filter((e) => e.athlete === athlete);
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    this.calls.push(`${method} ${url.pathname}${url.search}`);
    const auth = headers.get("authorization") ?? "";
    const [user, key] = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString("utf8").split(":");
    const athlete = user === "API_KEY" ? this.keys.get(key ?? "") : undefined;
    if (!athlete) return this.json(401, { status: 401, error: "Unauthorized" });
    if (this.rateLimitNext > 0) {
      this.rateLimitNext -= 1;
      return this.json(429, { error: "Too many requests" }, { "retry-after": "60" });
    }
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : null;

    if (url.pathname === "/api/v1/athlete/0" && method === "GET") return this.json(200, { id: athlete, name: "Athlète de test" });

    if (url.pathname === "/api/v1/athlete/0/activities" && method === "GET") {
      const oldest = url.searchParams.get("oldest");
      const newest = url.searchParams.get("newest");
      if (!oldest || !newest) return this.json(400, { error: "oldest and newest are required" });
      const inRange = (this.activities.get(athlete) ?? []).filter((a) => {
        const day = String(a.start_date_local ?? "").slice(0, 10);
        return day >= oldest && day <= newest;
      });
      // Comme intervals.icu : une activité reçue de Strava n'est pas transmise, seulement signalée.
      return this.json(
        200,
        inRange.map((a) => {
          if (a.source === "STRAVA") return { id: a.id, start_date_local: a.start_date_local, type: a.type, source: "STRAVA", _note: "STRAVA activities are not available via the API" };
          const { _streams, _intervals, ...summary } = a;
          void _streams;
          void _intervals;
          return summary;
        }),
      );
    }

    const activityPath = /^\/api\/v1\/activity\/([^/]+)\/(streams\.json|intervals)$/.exec(url.pathname);
    if (activityPath && method === "GET") {
      const activity = (this.activities.get(athlete) ?? []).find((a) => String(a.id) === decodeURIComponent(activityPath[1]));
      if (!activity || activity.source === "STRAVA") return this.json(404, { error: "Activity not found" });
      if (activityPath[2] === "intervals") return this.json(200, { id: activity.id, analyzed: new Date().toISOString(), icu_intervals: activity._intervals ?? [], icu_groups: [] });
      const types = new Set((url.searchParams.get("types") ?? "").split(",").filter(Boolean));
      const streams = (Array.isArray(activity._streams) ? activity._streams : []) as { type: string }[];
      return this.json(200, types.size ? streams.filter((stream) => types.has(stream.type)) : streams);
    }

    if (url.pathname === "/api/v1/athlete/0/wellness" && method === "GET") {
      const oldest = url.searchParams.get("oldest") ?? "";
      const newest = url.searchParams.get("newest") ?? "9999";
      return this.json(200, (this.wellness.get(athlete) ?? []).filter((w) => String(w.id) >= oldest && String(w.id) <= newest));
    }

    if (url.pathname === "/api/v1/athlete/0/events/bulk" && method === "POST" && url.searchParams.get("upsert") === "true") {
      if (!Array.isArray(body)) return this.json(400, { error: "Expected an array" });
      for (const event of body) {
        const valid =
          event.category === "WORKOUT" &&
          /^\d{4}-\d{2}-\d{2}T00:00:00$/.test(event.start_date_local ?? "") &&
          TYPES.has(event.type) &&
          typeof event.name === "string" &&
          event.name.length > 0 &&
          typeof event.description === "string" &&
          event.description.trim().length > 0 &&
          typeof event.external_id === "string";
        if (!valid) return this.json(422, { error: "Invalid event" });
        if (this.reject.has(event.external_id)) return this.json(422, { error: `Workout could not be parsed (${event.external_id})` });
      }
      const out = body.map((event: Omit<FakeEvent, "id" | "athlete" | "updated">) => {
        const existing = this.eventsOf(athlete).find((e) => e.external_id === event.external_id);
        const id = existing?.id ?? ++this.counter;
        const stored: FakeEvent = { ...event, id, athlete, updated: Date.now() };
        this.events.set(id, stored);
        return { id, external_id: stored.external_id, category: stored.category, start_date_local: stored.start_date_local, name: stored.name, uid: `uid-${id}` };
      });
      return this.json(200, out);
    }

    if (url.pathname === "/api/v1/athlete/0/sport-settings" && method === "GET") return this.json(200, this.settingsOf(athlete));

    const settingsPath = /^\/api\/v1\/athlete\/0\/sport-settings\/([^/]+)$/.exec(url.pathname);
    if (settingsPath && method === "PUT") {
      const list = this.settingsOf(athlete);
      const index = list.findIndex((s) => String(s.id) === decodeURIComponent(settingsPath[1]));
      if (index < 0) return this.json(404, { error: "Sport settings not found" });
      if (!body || typeof body !== "object" || Array.isArray(body)) return this.json(400, { error: "Expected an object" });
      // Comme l'API d'intervals.icu : seuls les champs envoyés changent (sauf simulation contraire).
      list[index] = this.replaceWholeSettings ? { ...body, id: list[index].id } : { ...list[index], ...body, id: list[index].id };
      return this.json(200, list[index]);
    }

    if (url.pathname === "/api/v1/athlete/0/events/bulk-delete" && method === "PUT") {
      if (!Array.isArray(body)) return this.json(400, { error: "Expected an array" });
      let deleted = 0;
      for (const { external_id } of body as { external_id: string }[]) {
        const existing = this.eventsOf(athlete).find((e) => e.external_id === external_id);
        if (existing) {
          this.events.delete(existing.id);
          deleted += 1;
        }
      }
      return this.json(200, deleted);
    }
    return this.json(404, { error: "Unknown fake endpoint" });
  };

  /** Sert le faux intervals.icu en HTTP (tests de bout en bout), avec un pilotage pour les tests. */
  async serve(port: number): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const body = await readBody(req);
      try {
        if (url.pathname.startsWith("/__control/")) {
          const payload = body ? JSON.parse(body) : {};
          if (url.pathname === "/__control/key") this.addKey(payload.key, payload.athlete);
          if (url.pathname === "/__control/activity") this.addActivity(payload.athlete, payload.activity);
          const events = payload.athlete ? this.eventsOf(payload.athlete) : [];
          const settings = payload.athlete ? this.settingsOf(payload.athlete) : [];
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, events, settings }));
          return;
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers[key] = value;
        const response = await this.fetch(url.toString(), { method: req.method, headers, body: body || undefined });
        const out: Record<string, string> = {};
        response.headers.forEach((value, key) => (out[key] = value));
        res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
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
