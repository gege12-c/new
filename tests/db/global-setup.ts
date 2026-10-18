/**
 * Démarre un PostgreSQL jetable, applique la couche de compatibilité Supabase puis les migrations.
 * - Si TEST_DATABASE_URL est défini, utilise ce serveur (une base neuve y est créée).
 * - Sinon, lance un cluster temporaire avec les binaires PostgreSQL locaux (PG_BIN pour les désigner).
 */
import { execFileSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const SHIMS = [path.join(ROOT, "supabase/shims/platform.sql"), path.join(HERE, "supabase-shim.sql")];

function findPgBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const dir = path.join(base, version, "bin");
      if (existsSync(path.join(dir, "initdb"))) return dir;
    }
  }
  try {
    return execFileSync("pg_config", ["--bindir"]).toString().trim();
  } catch {
    throw new Error("PostgreSQL introuvable : installez-le, ou définissez PG_BIN ou TEST_DATABASE_URL.");
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("port"))));
    });
  });
}

/** PostgreSQL refuse de tourner en root : on délègue alors à l'utilisateur système « postgres ». */
function runAs(): { uid: number; gid: number; user: string } | null {
  if (process.getuid?.() !== 0) return null;
  const user = process.env.PG_RUN_AS ?? "postgres";
  const uid = Number(execFileSync("id", ["-u", user]).toString().trim());
  const gid = Number(execFileSync("id", ["-g", user]).toString().trim());
  return { uid, gid, user };
}

function run(bin: string, args: string[], as: ReturnType<typeof runAs>) {
  if (as) execFileSync("runuser", ["-u", as.user, "--", bin, ...args], { stdio: "pipe" });
  else execFileSync(bin, args, { stdio: "pipe" });
}

async function applySchema(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const shim of SHIMS) await client.query(readFileSync(shim, "utf8"));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      try {
        await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        throw new Error(`Échec de la migration ${file} : ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    const dbName = `tricoach_test_${Date.now()}`;
    const admin = new pg.Client({ connectionString: external });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    await applySchema(url.toString());
    project.provide("databaseUrl", url.toString());
    return async () => {
      const cleanup = new pg.Client({ connectionString: external });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${dbName} with (force)`);
      await cleanup.end();
    };
  }

  const bin = findPgBin();
  const as = runAs();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tricoach-pg-"));
  const dataDir = path.join(dir, "data");
  if (as) chownSync(dir, as.uid, as.gid);
  const port = await freePort();

  run(path.join(bin, "initdb"), ["-D", dataDir, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=C"], as);
  run(
    path.join(bin, "pg_ctl"),
    [
      "-D",
      dataDir,
      "-l",
      path.join(dir, "postgres.log"),
      "-w",
      "-o",
      `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c timezone=UTC`,
      "start",
    ],
    as,
  );

  const base = `postgresql://postgres@127.0.0.1:${port}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query("create database tricoach_test");
  await admin.end();

  const url = `${base}/tricoach_test`;
  try {
    await applySchema(url);
  } catch (error) {
    run(path.join(bin, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], as);
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  project.provide("databaseUrl", url);

  return async () => {
    try {
      run(path.join(bin, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], as);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
