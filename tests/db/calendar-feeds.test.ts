/**
 * Agenda du téléphone : adresse secrète par athlète (empreinte seulement), remplacée ou retirée par
 * lui ; lue sans compte avec le jeton, qui ne donne que ses séances publiées ou annulées, ses
 * compétitions et ses jours indisponibles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, insertSession, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let other: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète agenda" });
  coach = await createUser({ name: "Coach agenda", coach: true });
  other = await createUser({ name: "Autre athlète agenda" });
  await linkCoach(coach, athlete);
});

afterAll(closeDb);

const feed = async (token: string) => (await as(null, "select public.calendar_feed($1) as f", [token])).rows[0].f;

describe("agenda du téléphone", () => {
  let token = "";

  it("l'athlète crée son adresse : seul le jeton est rendu, l'empreinte reste cachée", async () => {
    token = (await as(athlete, "select public.create_calendar_feed() as t")).rows[0].t;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const stored = await asSuperuser("select token_hash from public.calendar_feeds where athlete_id = $1", [athlete.id]);
    expect(stored.rows[0].token_hash).not.toBe(token);
    await expect(as(athlete, "select token_hash from public.calendar_feeds")).rejects.toThrow(/permission denied/);
    expect((await as(athlete, "select created_at from public.calendar_feeds")).rowCount).toBe(1);
    expect((await as(coach, "select created_at from public.calendar_feeds")).rowCount).toBe(0);
  });

  it("le jeton ouvre l'agenda sans compte : séances publiées et annulées, jamais les brouillons ni un autre athlète", async () => {
    const published = await insertSession(coach, athlete, { state: "published" });
    const draft = await insertSession(coach, athlete, { state: "draft" });
    const cancelled = await insertSession(coach, athlete, { state: "published" });
    await as(coach, "update public.planned_sessions set state = 'cancelled' where id = $1", [cancelled.id]);
    await insertSession(other, other, { state: "published" });
    await as(athlete, "insert into public.calendar_notes (athlete_id, kind, start_date, end_date, title) values ($1, 'unavailable', current_date + 3, current_date + 4, 'Rotation')", [athlete.id]);
    const result = await feed(token);
    expect(result.status).toBe("ok");
    const ids = result.sessions.map((s: { id: string }) => s.id);
    expect(ids).toContain(published.id);
    expect(ids).toContain(cancelled.id);
    expect(ids).not.toContain(draft.id);
    expect(result.sessions.every((s: { state: string }) => s.state !== "draft")).toBe(true);
    expect(result.notes.map((n: { title: string }) => n.title)).toEqual(["Rotation"]);
    expect(await feed("0".repeat(64))).toEqual({ status: "unauthorized" });
  });

  it("une nouvelle adresse remplace l'ancienne ; retirée, plus rien n'est lisible", async () => {
    const next = (await as(athlete, "select public.create_calendar_feed() as t")).rows[0].t;
    expect(next).not.toBe(token);
    expect(await feed(token)).toEqual({ status: "unauthorized" });
    expect((await feed(next)).status).toBe("ok");
    expect((await as(athlete, "select public.revoke_calendar_feed() as r")).rows[0].r).toBe(true);
    expect(await feed(next)).toEqual({ status: "unauthorized" });
  });

  it("personne d'autre ne crée ni ne retire l'adresse d'un athlète", async () => {
    await expect(as(null, "select public.create_calendar_feed()")).rejects.toThrow(/permission denied|not_authenticated/);
    await expect(as(athlete, "insert into public.calendar_feeds (athlete_id, token_hash) values ($1, $2)", [athlete.id, "a".repeat(64)])).rejects.toThrow(/permission denied/);
  });
});
