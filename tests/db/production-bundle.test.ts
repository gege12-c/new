/**
 * Le fichier de mise à jour de la production (supabase/production/pending.sql) est à jour, et il
 * s'applique en une fois sur une base au niveau de la production actuelle, tout ou rien.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PENDING = path.join(ROOT, "supabase/production/pending.sql");
const SHIMS = [path.join(ROOT, "supabase/shims/platform.sql"), path.join(ROOT, "tests/db/supabase-shim.sql")];
const dbName = `bundle_${Date.now()}`;
let admin: pg.Client;
let client: pg.Client;

function urlFor(database: string) {
  const url = new URL(inject("databaseUrl"));
  url.pathname = `/${database}`;
  return url.toString();
}

const applied = readFileSync(path.join(ROOT, "supabase/production/applied.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  client = new pg.Client({ connectionString: urlFor(dbName) });
  await client.connect();
  // Base au niveau de la production : couche Supabase, migrations déjà appliquées, registre des migrations.
  for (const shim of SHIMS) await client.query(readFileSync(shim, "utf8"));
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).sort();
  for (const file of files.filter((f) => applied.includes(f.slice(0, 14)))) {
    await client.query(readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8"));
  }
  await client.query("create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)");
  await client.query("insert into supabase_migrations.schema_migrations (version) select unnest($1::text[])", [applied]);
});

afterAll(async () => {
  await client?.end();
  await admin?.query(`drop database if exists ${dbName} with (force)`);
  await admin?.end();
});

describe("mise à jour de la production", () => {
  it("le fichier est à jour par rapport aux migrations", () => {
    expect(() => execFileSync("node", [path.join(ROOT, "scripts/production-sql.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it.runIf(existsSync(PENDING))("s'applique en une fois et inscrit les migrations", async () => {
    const sql = readFileSync(PENDING, "utf8");
    await client.query(sql);
    const { rows } = await client.query("select version from supabase_migrations.schema_migrations order by version");
    const pending = [...sql.matchAll(/^-- ===== (\d{14})_[a-z0-9_]+\.sql =====$/gm)].map((m) => m[1]);
    expect(rows.map((r) => r.version)).toEqual([...applied, ...pending].sort());
    const tables = await client.query("select to_regclass('public.activities') as a, to_regclass('public.workout_exports') as e");
    expect(tables.rows[0]).toEqual({ a: "activities", e: "workout_exports" });
  });

  it.runIf(existsSync(PENDING))("collé une seconde fois, il échoue sans rien modifier", async () => {
    const before = await client.query("select count(*)::int as n from supabase_migrations.schema_migrations");
    await expect(client.query(readFileSync(PENDING, "utf8"))).rejects.toThrow(/already exists/);
    await client.query("rollback").catch(() => undefined);
    const after = await client.query("select count(*)::int as n from supabase_migrations.schema_migrations");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
