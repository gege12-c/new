#!/usr/bin/env node
/**
 * Pile Supabase locale SANS Docker, pour développer et lancer les tests de bout en bout :
 * PostgreSQL (binaires locaux) + Supabase Auth (GoTrue) + PostgREST + une passerelle HTTP
 * qui expose /auth/v1 et /rest/v1 sur http://127.0.0.1:54321, comme `supabase start`.
 *
 * Realtime n'est pas inclus : les pages fonctionnent sans, la mise à jour en direct se teste
 * avec la pile Docker officielle (`supabase start`, utilisée par l'intégration continue).
 *
 *   node scripts/local-stack/stack.mjs start   démarre la pile (Ctrl-C pour l'arrêter)
 *   node scripts/local-stack/stack.mjs reset   efface les données locales
 *
 * Les binaires sont téléchargés une fois depuis les publications GitHub officielles.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = path.join(ROOT, ".local-stack");
const CACHE = path.join(os.homedir(), ".cache", "tricoach-stack");

const POSTGREST_VERSION = "12.2.12";
const AUTH_VERSION = "2.170.0";

export const PORTS = { api: 54321, db: 54322, rest: 54323, auth: 54324 };
/** Secret de développement de la CLI Supabase : jamais utilisé ailleurs qu'en local. */
export const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const DB_URL = `postgresql://postgres@127.0.0.1:${PORTS.db}/postgres`;

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export const ANON_KEY = signJwt({ iss: "supabase-local", role: "anon", iat: 1700000000, exp: 2000000000 });

function log(message) {
  process.stdout.write(`[stack] ${message}\n`);
}

function findPgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const dir = path.join(base, version, "bin");
      if (existsSync(path.join(dir, "initdb"))) return dir;
    }
  }
  return execFileSync("pg_config", ["--bindir"]).toString().trim();
}

/** PostgreSQL refuse de tourner en root : on passe alors par l'utilisateur système « postgres ». */
function asPostgres(bin, args) {
  return process.getuid?.() === 0 ? ["runuser", ["-u", "postgres", "--", bin, ...args]] : [bin, args];
}

function download(url, file) {
  execFileSync("curl", ["-sSfL", "--retry", "3", "-o", file, url], { stdio: "inherit" });
}

function ensureBinaries() {
  mkdirSync(CACHE, { recursive: true });
  const postgrest = path.join(CACHE, `postgrest-${POSTGREST_VERSION}`);
  if (!existsSync(postgrest)) {
    log(`téléchargement de PostgREST ${POSTGREST_VERSION}`);
    const archive = path.join(CACHE, "postgrest.tar.xz");
    download(
      `https://github.com/PostgREST/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-v${POSTGREST_VERSION}-linux-static-x86-64.tar.xz`,
      archive,
    );
    execFileSync("tar", ["-xJf", archive, "-C", CACHE]);
    execFileSync("mv", [path.join(CACHE, "postgrest"), postgrest]);
  }
  const authDir = path.join(CACHE, `auth-${AUTH_VERSION}`);
  if (!existsSync(path.join(authDir, "auth"))) {
    log(`téléchargement de Supabase Auth ${AUTH_VERSION}`);
    mkdirSync(authDir, { recursive: true });
    const archive = path.join(CACHE, "auth.tar.gz");
    download(`https://github.com/supabase/auth/releases/download/v${AUTH_VERSION}/auth-v${AUTH_VERSION}-x86.tar.gz`, archive);
    execFileSync("tar", ["-xzf", archive, "-C", authDir]);
  }
  return { postgrest, auth: path.join(authDir, "auth"), authMigrations: path.join(authDir, "migrations") };
}

const children = [];

function startChild(name, command, args, env = {}) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => process.stdout.write(`[${name}] ${line}\n`));
  child.stdout.on("data", prefix);
  child.stderr.on("data", prefix);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      log(`${name} s'est arrêté (code ${code}) : arrêt de la pile`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // pas encore prêt
    }
    if (Date.now() > deadline) throw new Error(`${label} ne répond pas`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function query(sql, params = []) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

/** Applique les migrations du dépôt pas encore passées, dans l'ordre de leur nom. */
export async function applyMigrations() {
  await query("create schema if not exists local_stack");
  await query("create table if not exists local_stack.migrations (name text primary key, applied_at timestamptz default now())");
  const applied = new Set((await query("select name from local_stack.migrations")).rows.map((r) => r.name));
  const dir = path.join(ROOT, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query("begin");
      await client.query(readFileSync(path.join(dir, file), "utf8"));
      await client.query("insert into local_stack.migrations (name) values ($1)", [file]);
      await client.query("commit");
      count += 1;
      log(`migration appliquée : ${file}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`Échec de la migration ${file} : ${error.message}`);
    } finally {
      await client.end();
    }
  }
  if (count) await query("notify pgrst, 'reload schema'");
  return count;
}

let shuttingDown = false;
let pgStop = null;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  try {
    pgStop?.();
  } catch {
    // déjà arrêté
  }
  process.exit(code);
}

function gateway() {
  const routes = [
    { prefix: "/auth/v1", port: PORTS.auth },
    { prefix: "/rest/v1", port: PORTS.rest },
  ];
  const cors = (req) => ({
    "access-control-allow-origin": req.headers.origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, x-client-info, prefer, range",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "content-range, x-supabase-api-version",
  });
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(req));
      res.end();
      return;
    }
    const route = routes.find((r) => req.url?.startsWith(`${r.prefix}/`) || req.url === r.prefix);
    if (!route) {
      res.writeHead(404, { "content-type": "application/json", ...cors(req) });
      res.end(JSON.stringify({ message: "Service non disponible dans la pile locale (Realtime, Storage…)." }));
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: route.port,
        method: req.method,
        path: req.url.slice(route.prefix.length) || "/",
        headers: { ...req.headers, host: `127.0.0.1:${route.port}` },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, { ...response.headers, ...cors(req) });
        response.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "application/json", ...cors(req) });
      res.end(JSON.stringify({ message: error.message }));
    });
    req.pipe(upstream);
  });
  // Realtime absent : on ferme proprement les connexions WebSocket.
  server.on("upgrade", (_req, socket) => socket.destroy());
  return new Promise((resolve) => server.listen(PORTS.api, "127.0.0.1", () => resolve(server)));
}

async function start() {
  const bins = ensureBinaries();
  const pgBin = findPgBin();
  const dataDir = path.join(STATE, "pgdata");
  const socketDir = path.join(STATE, "socket");
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  mkdirSync(socketDir, { recursive: true });
  if (process.getuid?.() === 0) {
    const uid = Number(execFileSync("id", ["-u", "postgres"]).toString());
    const gid = Number(execFileSync("id", ["-g", "postgres"]).toString());
    chownSync(STATE, uid, gid);
    chownSync(socketDir, uid, gid);
  }
  if (fresh) {
    log("création du cluster PostgreSQL");
    const [cmd, args] = asPostgres(path.join(pgBin, "initdb"), [
      "-D",
      dataDir,
      "-U",
      "postgres",
      "--auth=trust",
      "--encoding=UTF8",
      "--locale=C",
    ]);
    execFileSync(cmd, args, { stdio: "pipe" });
  }

  const [pgCmd, pgArgs] = asPostgres(path.join(pgBin, "postgres"), [
    "-D",
    dataDir,
    "-p",
    String(PORTS.db),
    "-k",
    socketDir,
    "-c",
    "listen_addresses=127.0.0.1",
    "-c",
    "timezone=UTC",
    "-c",
    "fsync=off",
  ]);
  startChild("postgres", pgCmd, pgArgs);
  pgStop = () => {
    const [cmd, args] = asPostgres(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-m", "fast", "stop"]);
    execFileSync(cmd, args, { stdio: "ignore" });
  };
  await waitFor(async () => (await query("select 1")).rowCount === 1, "PostgreSQL");

  await query(readFileSync(path.join(ROOT, "supabase/shims/platform.sql"), "utf8"));
  await query(`do $$ begin
    if not exists (select 1 from pg_namespace where nspname = 'auth') then
      create schema auth authorization supabase_auth_admin;
    end if;
  end $$`);
  await query("grant usage on schema auth to anon, authenticated, service_role");
  await query("alter role supabase_auth_admin set search_path = auth");

  startChild("auth", bins.auth, [], {
    GOTRUE_API_HOST: "127.0.0.1",
    PORT: String(PORTS.auth),
    API_EXTERNAL_URL: `${API_URL}/auth/v1`,
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:postgres@127.0.0.1:${PORTS.db}/postgres?sslmode=disable`,
    GOTRUE_DB_MIGRATIONS_PATH: bins.authMigrations,
    GOTRUE_SITE_URL: "http://localhost:3000",
    GOTRUE_URI_ALLOW_LIST: "http://localhost:3000/**,http://127.0.0.1:3000/**",
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_JWT_SECRET: JWT_SECRET,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_EXTERNAL_PHONE_ENABLED: "false",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
    GOTRUE_LOG_LEVEL: "warn",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORTS.auth}/health`)).ok, "Supabase Auth", 60000);

  await applyMigrations();

  const restConfig = path.join(STATE, "postgrest.conf");
  writeFileSync(
    restConfig,
    [
      `db-uri = "postgres://authenticator:postgres@127.0.0.1:${PORTS.db}/postgres"`,
      'db-schemas = "public"',
      'db-anon-role = "anon"',
      `jwt-secret = "${JWT_SECRET}"`,
      'server-host = "127.0.0.1"',
      `server-port = ${PORTS.rest}`,
      "db-channel-enabled = true",
      'log-level = "warn"',
    ].join("\n"),
  );
  startChild("rest", bins.postgrest, [restConfig]);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORTS.rest}/`)).status < 500, "PostgREST");

  await gateway();
  writeFileSync(
    path.join(ROOT, ".env.local-stack"),
    [`NEXT_PUBLIC_SUPABASE_URL=${API_URL}`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}`, ""].join("\n"),
  );
  log(`prête : API ${API_URL}, base ${DB_URL}`);
  log("variables de l'application dans .env.local-stack");
}

const command = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === "start") {
    process.on("SIGINT", () => shutdown(0));
    process.on("SIGTERM", () => shutdown(0));
    start().catch((error) => {
      process.stderr.write(`[stack] ${error.message}\n`);
      shutdown(1);
    });
  } else if (command === "reset") {
    rmSync(STATE, { recursive: true, force: true });
    log("données locales effacées");
  } else if (command === "migrate") {
    applyMigrations()
      .then((count) => log(`${count} migration(s) appliquée(s)`))
      .catch((error) => {
        process.stderr.write(`[stack] ${error.message}\n`);
        process.exit(1);
      });
  } else {
    process.stdout.write("Usage : node scripts/local-stack/stack.mjs start | migrate | reset\n");
  }
}
