/**
 * Outils des tests de base de données : chaque requête s'exécute dans sa propre transaction,
 * sous le rôle et l'identité JWT qu'aurait l'utilisateur derrière l'API Supabase.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, inject } from "vitest";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: inject("databaseUrl"), max: 4 });
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

/** Requête en superutilisateur (équivalent de la clé de service ou de l'éditeur SQL). */
export function asSuperuser(sql: string, params: unknown[] = []) {
  return db().query(sql, params);
}

/** Crée un compte comme le ferait Supabase Auth ; le trigger crée le profil. */
export async function createUser(options: { name: string; coach?: boolean; confirmed?: boolean; email?: string }) {
  const email = (options.email ?? `${options.name.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 8)}@test.local`).toLowerCase();
  const { rows } = await asSuperuser(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     values ($1, case when $2 then now() end, $3) returning id`,
    [email, options.confirmed ?? true, JSON.stringify({ display_name: options.name, is_coach: options.coach ?? false })],
  );
  return { id: rows[0].id as string, email, name: options.name } satisfies TestUser;
}

/** Exécute une requête en tant qu'utilisateur connecté (null = visiteur anonyme). */
export async function as(user: TestUser | null, sql: string, params: unknown[] = []) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(user ? "set local role authenticated" : "set local role anon");
    const claims = user ? { sub: user.id, email: user.email, role: "authenticated" } : { role: "anon" };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await client.query(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Vérifie qu'une requête échoue avec un message reconnaissable. */
export async function expectFailure(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toThrow(pattern);
}

/** Message d'une politique RLS ou d'un privilège manquant. */
export const DENIED = /row-level security|permission denied/;

/** Invite puis fait accepter : le parcours complet coach → athlète. */
export async function linkCoach(coach: TestUser, athlete: TestUser) {
  const { rows } = await as(coach, "select * from public.create_invitation($1)", [athlete.email]);
  const token = rows[0].token as string;
  const accepted = await as(athlete, "select public.accept_invitation($1) as link_id", [token]);
  return accepted.rows[0].link_id as string;
}

export function workoutJson() {
  const parsed = parseWorkout(bikeThreshold);
  if (!parsed.success) throw new Error("fixture invalide");
  return JSON.stringify(parsed.data);
}

/** Insère une séance planifiée pour un athlète, en tant que `author`. */
export async function insertSession(
  author: TestUser,
  athlete: TestUser,
  overrides: { state?: "draft" | "published" | "cancelled"; title?: string; date?: string } = {},
) {
  const { rows } = await as(
    author,
    `insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state)
     values ($1, $2, 'bike', $3, $4::jsonb, $5) returning id, version`,
    [athlete.id, overrides.date ?? "2026-11-02", overrides.title ?? "Seuil 4 × 8 min", workoutJson(), overrides.state ?? "published"],
  );
  return rows[0] as { id: string; version: number };
}
