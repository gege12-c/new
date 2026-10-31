/**
 * Faux intervals.icu, pour les tests uniquement : clé API personnelle (authentification « Basic »,
 * utilisateur API_KEY), profil de l'athlète, dépôt en lot des séances prévues par identifiant externe
 * (création ou mise à jour), retrait en lot, quota (429). Données entièrement fictives.
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
  private counter = 1000;

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
          const events = payload.athlete ? this.eventsOf(payload.athlete) : [];
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, events }));
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
