/**
 * Notes de calendrier et jours indisponibles : posées par l'athlète ou par un coach qui planifie
 * pour lui, lues par l'athlète et ses coachs actifs seulement, modifiées par leur auteur (et par
 * l'athlète sur son calendrier), journalisées, signalées en temps réel ; périodes contrôlées.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let watcher: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète notes" });
  coach = await createUser({ name: "Coach notes", coach: true });
  watcher = await createUser({ name: "Coach qui regarde", coach: true });
  stranger = await createUser({ name: "Coach étranger notes", coach: true });
  await linkCoach(coach, athlete);
  const link = await linkCoach(watcher, athlete);
  // Ce coach voit le calendrier mais ne planifie pas.
  await as(athlete, "select public.set_coach_permissions($1, false, true)", [link]);
});

afterAll(closeDb);

const insert = (user: TestUser, values: { kind?: string; start?: string; end?: string; title?: string | null }) =>
  as(
    user,
    "insert into public.calendar_notes (athlete_id, kind, start_date, end_date, title) values ($1, $2, $3, $4, $5) returning id, created_by",
    [athlete.id, values.kind ?? "unavailable", values.start ?? "2027-02-01", values.end ?? values.start ?? "2027-02-03", values.title ?? "Rotation Tokyo"],
  );

describe("notes de calendrier", () => {
  it("l'athlète et le coach qui planifie en posent ; l'auteur est enregistré", async () => {
    const own = await insert(athlete, { title: "Rotation" });
    expect(own.rows[0].created_by).toBe(athlete.id);
    const byCoach = await insert(coach, { kind: "note", start: "2027-02-10", title: "Stage à Font-Romeu" });
    expect(byCoach.rows[0].created_by).toBe(coach.id);
  });

  it("lues par l'athlète et tous ses coachs actifs, jamais par un autre", async () => {
    await insert(athlete, { kind: "sick", start: "2027-03-01", title: "Grippe" });
    const count = async (user: TestUser) => (await as(user, "select count(*)::int as n from public.calendar_notes where athlete_id = $1", [athlete.id])).rows[0].n;
    const total = await count(athlete);
    expect(total).toBeGreaterThan(0);
    expect(await count(coach)).toBe(total);
    expect(await count(watcher)).toBe(total);
    expect(await count(stranger)).toBe(0);
  });

  it("un coach sans droit de planifier, ou étranger, n'en pose pas", async () => {
    await expectFailure(insert(watcher, {}), DENIED);
    await expectFailure(insert(stranger, {}), DENIED);
    // Usurper un auteur est refusé.
    await expectFailure(
      as(coach, "insert into public.calendar_notes (athlete_id, kind, start_date, end_date, created_by) values ($1, 'note', '2027-04-01', '2027-04-01', $2)", [athlete.id, athlete.id]),
      /permission denied/,
    );
  });

  it("l'auteur modifie et retire sa note ; l'athlète aussi, sur son calendrier ; personne d'autre", async () => {
    const id = (await insert(coach, { kind: "travel", start: "2027-05-01", title: "Déplacement" })).rows[0].id;
    expect((await as(coach, "update public.calendar_notes set title = 'Déplacement Lyon' where id = $1 returning id", [id])).rowCount).toBe(1);
    expect((await as(watcher, "update public.calendar_notes set title = 'Non' where id = $1 returning id", [id])).rowCount).toBe(0);
    expect((await as(stranger, "delete from public.calendar_notes where id = $1 returning id", [id])).rowCount).toBe(0);
    const own = (await insert(athlete, { start: "2027-05-10" })).rows[0].id;
    // Le coach ne touche pas à la note de l'athlète.
    expect((await as(coach, "delete from public.calendar_notes where id = $1 returning id", [own])).rowCount).toBe(0);
    expect((await as(athlete, "update public.calendar_notes set kind = 'holiday' where id = $1 returning id", [id])).rowCount).toBe(1);
    expect((await as(athlete, "delete from public.calendar_notes where id = $1 returning id", [id])).rowCount).toBe(1);
  });

  it("périodes et valeurs contrôlées", async () => {
    await expectFailure(insert(athlete, { start: "2027-06-10", end: "2027-06-01" }), /calendar_notes_range/);
    await expectFailure(insert(athlete, { start: "2027-01-01", end: "2028-06-01" }), /calendar_notes_range/);
    await expectFailure(insert(athlete, { kind: "party" }), /calendar_notes_kind_check/);
    await expectFailure(insert(athlete, { title: "x".repeat(81) }), /calendar_notes_title_check/);
  });

  it("journalisées et signalées sur le canal de l'athlète", async () => {
    const id = (await insert(athlete, { kind: "injured", start: "2027-07-01", title: "Mollet" })).rows[0].id;
    const audit = await asSuperuser("select action, actor_id from public.audit_logs where entity_type = 'calendar_notes' and entity_id = $1", [id]);
    expect(audit.rows).toEqual([{ action: "insert", actor_id: athlete.id }]);
    const topics = await asSuperuser(
      "select topic from realtime.messages where payload ->> 'table' = 'calendar_notes' and inserted_at > now() - interval '1 minute'",
    );
    expect(topics.rows.map((r) => r.topic)).toContain(`athlete:${athlete.id}`);
  });
});
