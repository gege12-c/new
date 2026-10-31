/**
 * Faux Suunto, pour les tests uniquement : OAuth (code, jetons qui expirent, jeton de renouvellement
 * qui change à chaque usage, retrait d'accès) et API des guides (archive zip contrôlée, identifiant
 * externe unique par compte, liste paginée dans une enveloppe), avec les réponses de la passerelle
 * de Suunto (401 pour un quota dépassé). Données entièrement fictives.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { GuideSchema, ManifestSchema, type SuuntoGuide } from "@/lib/suunto/guide";
import { pngSize, readZip } from "@/lib/suunto/zip";

export interface FakeGuide {
  id: string;
  user: string;
  externalId: string | null;
  owner: string;
  name: string;
  guide: SuuntoGuide | null;
  modificationTime: number;
}

interface FakeUser {
  name: string;
  access: Map<string, number>; // jeton → expiration (ms)
  refreshToken: string | null;
  authorized: boolean;
}

export class FakeSuunto {
  readonly clientId = "suunto-client";
  readonly clientSecret = "suunto-secret";
  readonly subscriptionKey = "suunto-subscription";
  readonly appName = "TriCoach";
  readonly users = new Map<string, FakeUser>();
  readonly codes = new Map<string, string>(); // code → utilisateur
  readonly guides = new Map<string, FakeGuide>();
  readonly calls: string[] = [];
  /** Durée de vie des jetons d'accès. */
  tokenTtlSeconds = 3600;
  /** Les N prochains appels à l'API reçoivent la réponse « quota dépassé » de la passerelle (401). */
  rateLimitNext = 0;
  /** Les N prochains envois de guide sont refusés (400) comme un guide invalide. */
  rejectNext = 0;
  /** La création ne renvoie pas l'identifiant (il faut le relire dans la liste). */
  omitIdOnCreate = false;
  /** Utilisateur que la page d'autorisation (navigateur) connecte. */
  authorizeAs: string | null = null;
  private counter = 0;

  addUser(name: string) {
    if (!this.users.has(name)) this.users.set(name, { name, access: new Map(), refreshToken: null, authorized: true });
    return this.users.get(name)!;
  }

  issueCode(user: string) {
    this.addUser(user);
    const code = `code-${user}-${++this.counter}`;
    this.codes.set(code, user);
    return code;
  }

  /** L'athlète retire l'accès de l'application depuis Suunto. */
  revoke(user: string) {
    const entry = this.users.get(user);
    if (!entry) return;
    entry.authorized = false;
    entry.access.clear();
    entry.refreshToken = null;
  }

  expireTokens() {
    for (const user of this.users.values()) for (const token of user.access.keys()) user.access.set(token, 0);
  }

  guidesOf(user: string) {
    return [...this.guides.values()].filter((g) => g.user === user);
  }

  /** Guide déposé hors de TriCoach (autre application ou appli Suunto). */
  addForeignGuide(user: string, fields: { externalId?: string | null; owner?: string; name?: string }) {
    const id = `g${++this.counter}`;
    this.guides.set(id, {
      id,
      user,
      externalId: fields.externalId ?? null,
      owner: fields.owner ?? "Autre application",
      name: fields.name ?? "Guide",
      guide: null,
      modificationTime: Date.now(),
    });
    return id;
  }

  private tokens(user: FakeUser) {
    const access = `acc-${user.name}-${++this.counter}`;
    user.access.set(access, Date.now() + this.tokenTtlSeconds * 1000);
    user.refreshToken = `ref-${user.name}-${++this.counter}`;
    user.authorized = true;
    return { access_token: access, refresh_token: user.refreshToken, expires_in: this.tokenTtlSeconds, token_type: "bearer", user: user.name };
  }

  private json(status: number, body: unknown) {
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  private bearer(headers: Headers): FakeUser | null {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    for (const user of this.users.values()) {
      const expires = user.access.get(token);
      if (expires !== undefined && user.authorized && expires > Date.now()) return user;
    }
    return null;
  }

  /** Archive reçue : trois fichiers, guide et manifeste au format, icône de 300 × 300. */
  private unpack(body: Uint8Array): { guide: SuuntoGuide; owner: string } | string {
    try {
      const entries = new Map(readZip(body).map((e) => [e.name, e.data]));
      const text = (name: string) => new TextDecoder().decode(entries.get(name));
      const guide = GuideSchema.safeParse(JSON.parse(text("guide.json")));
      const manifest = ManifestSchema.safeParse(JSON.parse(text("manifest.json")));
      const icon = entries.get("icon.png");
      if (!guide.success || !manifest.success) return "Invalid guide.json or manifest.json";
      if (!icon || JSON.stringify(pngSize(icon)) !== JSON.stringify({ width: 300, height: 300 })) return "icon.png must be 300x300";
      return { guide: guide.data, owner: manifest.data.owner };
    } catch {
      return "Invalid zip";
    }
  }

  /** Point d'entrée « fetch » : même interface que l'API réelle. */
  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    this.calls.push(`${method} ${url.pathname}`);

    if (url.pathname.endsWith("/oauth/token") && method === "POST") {
      const expected = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
      if (headers.get("authorization") !== expected) return this.json(401, { error: "invalid_client" });
      const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      if (form.get("grant_type") === "authorization_code") {
        const user = this.codes.get(form.get("code") ?? "");
        if (!user) return this.json(400, { error: "invalid_grant" });
        this.codes.delete(form.get("code")!);
        return this.json(200, this.tokens(this.users.get(user)!));
      }
      // Le jeton de renouvellement ne sert qu'une fois.
      const user = [...this.users.values()].find((u) => u.refreshToken && u.refreshToken === form.get("refresh_token"));
      if (!user || !user.authorized) return this.json(400, { error: "invalid_grant" });
      return this.json(200, this.tokens(user));
    }

    if (headers.get("ocp-apim-subscription-key") !== this.subscriptionKey) {
      return this.json(401, { statusCode: 401, message: "Access denied due to missing subscription key." });
    }
    if (this.rateLimitNext > 0) {
      this.rateLimitNext -= 1;
      return this.json(401, { error: { code: "RateLimitExceeded", message: "Rate limit is exceeded. Try again in 90 seconds." } });
    }
    const user = this.bearer(headers);
    if (!user) return this.json(401, { error: { code: "Unauthorized", message: "Invalid token" } });

    if (url.pathname === "/v2/guides/items" && method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const payload = this.guidesOf(user.name)
        .slice(offset, offset + limit)
        .map((g) => ({ id: g.id, externalId: g.externalId, owner: g.owner, name: g.name, modificationTime: g.modificationTime }));
      return this.json(200, { error: null, payload, metadata: { offset, limit } });
    }

    const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
    if (url.pathname === "/v2/guides/files" && method === "POST") {
      if (headers.get("content-type") !== "application/zip") return this.json(400, { error: { description: "Content-Type must be application/zip" } });
      const unpacked = this.unpack(body);
      if (typeof unpacked === "string") return this.json(400, { error: { description: unpacked } });
      if (unpacked.owner !== this.appName || unpacked.guide.owner !== this.appName) return this.json(400, { error: { description: "Guide owner does not match the application" } });
      if (this.rejectNext > 0) {
        this.rejectNext -= 1;
        return this.json(400, { error: { description: "Guide validation failed" } });
      }
      if (this.guidesOf(user.name).some((g) => g.externalId && g.externalId === unpacked.guide.externalId)) {
        return this.json(409, { error: { description: "Duplicate externalId" } });
      }
      const id = `g${++this.counter}`;
      this.guides.set(id, {
        id,
        user: user.name,
        externalId: unpacked.guide.externalId,
        owner: unpacked.owner,
        name: unpacked.guide.name,
        guide: unpacked.guide,
        modificationTime: Date.now(),
      });
      return this.json(201, this.omitIdOnCreate ? { error: null, payload: null } : { error: null, payload: { id } });
    }

    const match = url.pathname.match(/^\/v2\/guides\/files\/([^/]+)$/);
    if (match) {
      const existing = this.guides.get(decodeURIComponent(match[1]));
      if (!existing || existing.user !== user.name) return this.json(404, { error: { description: "Guide not found" } });
      if (method === "DELETE") {
        this.guides.delete(existing.id);
        return this.json(200, { error: null, payload: null });
      }
      if (method === "PUT") {
        const unpacked = this.unpack(body);
        if (typeof unpacked === "string") return this.json(400, { error: { description: unpacked } });
        if (unpacked.owner !== this.appName) return this.json(400, { error: { description: "Guide owner does not match the application" } });
        if (this.rejectNext > 0) {
          this.rejectNext -= 1;
          return this.json(400, { error: { description: "Guide validation failed" } });
        }
        Object.assign(existing, { externalId: unpacked.guide.externalId, name: unpacked.guide.name, guide: unpacked.guide, modificationTime: Date.now() });
        return this.json(200, { error: null, payload: { id: existing.id } });
      }
    }
    return this.json(404, { error: { description: "Unknown fake endpoint" } });
  };

  /** Sert le faux Suunto en HTTP (tests de bout en bout) : API, page d'autorisation et pilotage. */
  async serve(port: number): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const body = await readBody(req);
      try {
        if (url.pathname === "/oauth/authorize") {
          // Page d'autorisation : l'utilisateur désigné accepte aussitôt.
          const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
          redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
          redirect.searchParams.set("code", this.issueCode(this.authorizeAs ?? "athlete-e2e"));
          res.writeHead(302, { location: redirect.toString() }).end();
          return;
        }
        if (url.pathname.startsWith("/__control/")) {
          const payload = body.length ? JSON.parse(body.toString("utf8")) : {};
          if (url.pathname === "/__control/authorize-as") this.authorizeAs = payload.user;
          else if (url.pathname === "/__control/revoke") this.revoke(payload.user);
          const guides = payload.user ? this.guidesOf(payload.user) : [];
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, guides }));
          return;
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers[key] = value;
        const contentType = headers["content-type"] ?? "";
        const response = await this.fetch(url.toString(), {
          method: req.method,
          headers,
          body: !body.length ? undefined : contentType.startsWith("application/zip") ? new Uint8Array(body) : body.toString("utf8"),
        });
        const out: Record<string, string> = {};
        response.headers.forEach((value, key) => (out[key] = value));
        res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));
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

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
