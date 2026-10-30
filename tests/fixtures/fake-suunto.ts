/**
 * Faux Suunto, pour les tests uniquement : OAuth (code, jetons qui expirent et tournent) et guides
 * SuuntoPlus (création, mise à jour, suppression, liste), avec la clé d'abonnement vérifiée.
 * Données entièrement fictives.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Fetcher } from "@/lib/suunto/api";
import { readZip } from "@/lib/suunto/zip";

interface FakeGuide {
  id: string;
  owner: string;
  name: string;
  guide: Record<string, unknown>;
  user: string;
}

export class FakeSuunto {
  readonly clientId = "suunto-app-id";
  readonly clientSecret = "suunto-app-secret";
  readonly subscriptionKey = "sub-key-0123";
  readonly appName = "TriCoach";
  readonly guides = new Map<string, FakeGuide>();
  readonly codes = new Map<string, string>(); // code → utilisateur
  readonly access = new Map<string, { user: string; expiresAt: number }>();
  readonly refresh = new Map<string, string>();
  readonly calls: string[] = [];
  /** Durée de vie des jetons d'accès, en secondes. */
  tokenTtl = 3600;
  /** Prochaine réponse forcée (quota, panne), consommée au premier appel suivant. */
  nextFailure: { status: number; body?: string; retryAfter?: number } | null = null;
  private counter = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  issueCode(user: string): string {
    const code = `code-${user}-${++this.counter}`;
    this.codes.set(code, user);
    return code;
  }

  /** Révoque l'accès (comme l'utilisateur depuis son compte Suunto). */
  revokeUser(user: string) {
    for (const [token, grant] of this.access) if (grant.user === user) this.access.delete(token);
    for (const [token, owner] of this.refresh) if (owner === user) this.refresh.delete(token);
  }

  private issueTokens(user: string) {
    const accessToken = `at-${user}-${++this.counter}`;
    const refreshToken = `rt-${user}-${this.counter}`;
    this.access.set(accessToken, {
      user,
      expiresAt: this.clock().getTime() + this.tokenTtl * 1000,
    });
    this.refresh.set(refreshToken, user);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.tokenTtl,
      user,
    };
  }

  readonly fetch: Fetcher = async (input, init): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}`);
    const headers = new Headers(init?.headers);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      return new Response(failure.body ?? "", {
        status: failure.status,
        headers: failure.retryAfter ? { "Retry-After": String(failure.retryAfter) } : {},
      });
    }

    if (url.pathname === "/oauth/token") {
      const basic = headers.get("authorization") ?? "";
      if (basic !== `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`) return json(401, { error: "invalid_client" });
      const raw = init?.body;
      const params = new URLSearchParams(typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : "");
      if (params.get("grant_type") === "authorization_code") {
        const user = this.codes.get(params.get("code") ?? "");
        if (!user) return json(400, { error: "invalid_grant" });
        this.codes.delete(params.get("code") as string);
        return json(200, this.issueTokens(user));
      }
      if (params.get("grant_type") === "refresh_token") {
        const token = params.get("refresh_token") ?? "";
        const user = this.refresh.get(token);
        if (!user) return json(400, { error: "invalid_grant" });
        this.refresh.delete(token); // les jetons de renouvellement tournent
        return json(200, this.issueTokens(user));
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    if (headers.get("ocp-apim-subscription-key") !== this.subscriptionKey) return json(403, { error: "subscription key" });
    const bearer = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const grant = this.access.get(bearer);
    if (!grant || grant.expiresAt <= this.clock().getTime()) return json(401, { error: "invalid token" });

    const readGuide = async (): Promise<{ guide: Record<string, unknown>; error?: undefined } | { error: Response; guide?: undefined }> => {
      const body = init?.body as Uint8Array | undefined;
      if (headers.get("content-type") !== "application/zip" || !body) throw new Error("not a zip");
      const entries = readZip(body);
      const names = entries.map((e) => e.name).sort();
      if (names.join(",") !== "guide.json,icon.png,manifest.json") throw new Error(`zip incomplet : ${names.join(",")}`);
      const guide = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === "guide.json")!.data)) as Record<string, unknown>;
      if (guide.owner !== this.appName)
        return {
          error: json(400, { error: { description: "owner mismatch" } }),
        };
      return { guide };
    };

    if (method === "POST" && url.pathname === "/v2/guides/files") {
      const read = await readGuide();
      if (read.error) return read.error;
      const id = `g-${++this.counter}`;
      this.guides.set(id, {
        id,
        owner: String(read.guide.owner),
        name: String(read.guide.name),
        guide: read.guide,
        user: grant.user,
      });
      return json(200, { id });
    }
    const match = url.pathname.match(/^\/v2\/guides\/files\/(.+)$/);
    if (match && method === "PUT") {
      const existing = this.guides.get(match[1]);
      if (!existing || existing.user !== grant.user) return json(404, { error: "not found" });
      const read = await readGuide();
      if (read.error) return read.error;
      existing.guide = read.guide;
      existing.name = String(read.guide.name);
      return json(200, { id: existing.id });
    }
    if (match && method === "DELETE") {
      const existing = this.guides.get(match[1]);
      if (!existing || existing.user !== grant.user) return json(404, { error: "not found" });
      this.guides.delete(match[1]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/v2/guides/items") {
      return json(200, {
        items: [...this.guides.values()].filter((g) => g.user === grant.user).map((g) => ({ id: g.id, name: g.name })),
      });
    }
    return json(404, { error: "unknown" });
  };

  /** Utilisateur Suunto que la page d'autorisation (navigateur) connecte. */
  authorizeAs = "athlete-e2e";

  /** Serveur HTTP pour les tests de bout en bout : page d'autorisation, API, et une porte de contrôle. */
  async serve(port: number): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const body = await readBody(req);
      try {
        if (url.pathname === "/oauth/authorize") {
          const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
          redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
          redirect.searchParams.set("code", this.issueCode(this.authorizeAs));
          res.writeHead(302, { location: redirect.toString() }).end();
          return;
        }
        if (url.pathname === "/__control/guides") {
          const user = url.searchParams.get("user") ?? this.authorizeAs;
          const list = [...this.guides.values()].filter((g) => g.user === user).map((g) => ({ id: g.id, name: g.name, guide: g.guide }));
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
          return;
        }
        if (url.pathname === "/__control/revoke") {
          this.revokeUser(url.searchParams.get("user") ?? this.authorizeAs);
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
          return;
        }
        const response = await this.fetch(url.toString(), {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: body.length ? (new Uint8Array(body) as unknown as BodyInit) : undefined,
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

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
