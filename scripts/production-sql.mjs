#!/usr/bin/env node
/**
 * Fichier SQL unique de mise à jour de la base de production : toutes les migrations du dépôt
 * absentes de supabase/production/applied.txt, dans l'ordre, en une seule transaction (tout ou
 * rien), suivies de leur inscription dans supabase_migrations.schema_migrations.
 *
 *   node scripts/production-sql.mjs           écrit supabase/production/pending.sql
 *   node scripts/production-sql.mjs --check   échoue si le fichier n'est pas à jour
 *
 * Le fichier se colle tel quel dans Supabase > SQL Editor. Il est régénéré, jamais édité à la main.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const APPLIED = path.join(ROOT, "supabase/production/applied.txt");
export const PENDING = path.join(ROOT, "supabase/production/pending.sql");

export function appliedVersions() {
  return new Set(
    readFileSync(APPLIED, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

export function pendingMigrations() {
  const applied = appliedVersions();
  return readdirSync(MIGRATIONS)
    .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file) => ({ file, version: file.slice(0, 14), name: file.slice(15, -4) }))
    .filter((m) => !applied.has(m.version));
}

/** Contenu attendu de pending.sql, ou null s'il n'y a rien à appliquer. */
export function buildPendingSql() {
  const pending = pendingMigrations();
  if (!pending.length) return null;
  const parts = [
    "-- TriCoach : mise à jour de la base de production.",
    "-- Généré par scripts/production-sql.mjs à partir de supabase/migrations : ne pas modifier à la main.",
    `-- Migrations incluses : ${pending.map((m) => m.file).join(", ")}.`,
    "-- Mode d'emploi : Supabase > SQL Editor > New query, coller tout le fichier, puis Run.",
    "-- Tout ou rien : en cas d'erreur, la transaction est annulée et la base reste inchangée.",
    "",
    "begin;",
    "",
  ];
  for (const migration of pending) {
    parts.push(`-- ===== ${migration.file} =====`, "", readFileSync(path.join(MIGRATIONS, migration.file), "utf8").trimEnd(), "");
  }
  parts.push(
    "-- ===== Inscription des migrations appliquées =====",
    "",
    "insert into supabase_migrations.schema_migrations (version, name)",
    `values ${pending.map((m) => `('${m.version}', '${m.name}')`).join(", ")}`,
    "on conflict (version) do nothing;",
    "",
    "commit;",
    "",
  );
  return parts.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = buildPendingSql();
  const current = existsSync(PENDING) ? readFileSync(PENDING, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (expected !== current) {
      console.error("supabase/production/pending.sql n'est pas à jour : lancez node scripts/production-sql.mjs");
      process.exit(1);
    }
    console.log(expected ? "pending.sql à jour." : "Aucune migration en attente.");
  } else if (expected) {
    writeFileSync(PENDING, expected);
    console.log(`pending.sql écrit (${pendingMigrations().map((m) => m.file).join(", ")}).`);
  } else {
    if (current !== null) rmSync(PENDING);
    console.log("Aucune migration en attente pour la production.");
  }
}
