/**
 * Séances prévues dans intervals.icu, reprises dans TriCoach : écrites par le serveur seul, en lecture
 * seule pour l'athlète comme pour son coach (ni modifiées, ni déplacées, ni supprimées), sans
 * notification ni envoi vers la montre de la part de TriCoach, exclues de la copie d'une semaine ;
 * une séance de TriCoach ne peut pas se faire passer pour une séance reprise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, linkCoach, workoutJson, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let imported = "";

const MONDAY = "2027-03-01";

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète calendrier intervals" });
  coach = await createUser({ name: "Coach calendrier intervals", coach: true });
  await linkCoach(coach, athlete);
  await asSuperuser("delete from public.notifications where recipient_id = any($1)", [[athlete.id, coach.id]]);
  await asSuperuser("delete from public.sync_jobs where athlete_id = $1", [athlete.id]);
  // Écrite par le serveur (clé de service), comme à la réception.
  const { rows } = await asSuperuser(
    `insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state, source, external_id, import_notes)
     values ($1, $2, 'bike', '3x10 seuil', $3::jsonb, 'published', 'intervals', '81234', array['Une cible n''a pas pu être reprise.'])
     returning id, created_by, version, published_at`,
    [athlete.id, MONDAY, workoutJson()],
  );
  imported = rows[0].id;
  expect(rows[0]).toMatchObject({ created_by: null, version: 1 });
  expect(rows[0].published_at).not.toBeNull();
});

afterAll(closeDb);

describe("séances reprises d'intervals.icu", () => {
  it("visibles de l'athlète et de son coach, avec leur source", async () => {
    for (const user of [athlete, coach]) {
      const { rows } = await as(user, "select source, external_id, import_notes from public.planned_sessions where id = $1", [imported]);
      expect(rows).toEqual([{ source: "intervals", external_id: "81234", import_notes: ["Une cible n'a pas pu être reprise."] }]);
    }
  });

  it("ni modifiées, ni déplacées, ni supprimées par l'athlète ou son coach", async () => {
    await expectFailure(as(athlete, "update public.planned_sessions set scheduled_date = '2027-03-02' where id = $1", [imported]), /imported_session_read_only/);
    await expectFailure(as(coach, "update public.planned_sessions set title = 'Autre chose' where id = $1", [imported]), /imported_session_read_only/);
    for (const user of [athlete, coach]) {
      const { rowCount } = await as(user, "delete from public.planned_sessions where id = $1", [imported]);
      expect(rowCount).toBe(0);
    }
    const { rows } = await asSuperuser("select title, scheduled_date::text as date, version from public.planned_sessions where id = $1", [imported]);
    expect(rows).toEqual([{ title: "3x10 seuil", date: MONDAY, version: 1 }]);
  });

  it("le serveur seul la tient à jour ; une séance de TriCoach ne devient pas une séance reprise", async () => {
    await asSuperuser("update public.planned_sessions set title = '3x12 seuil', external_updated_at = now() where id = $1", [imported]);
    const { rows } = await asSuperuser("select title, version from public.planned_sessions where id = $1", [imported]);
    expect(rows).toEqual([{ title: "3x12 seuil", version: 2 }]);
    // Colonnes hors de portée de l'API, et contrôlées par la base même pour le serveur.
    await expectFailure(
      as(coach, "insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state, source, external_id) values ($1, $2, 'bike', 'x', $3::jsonb, 'published', 'intervals', '1')", [athlete.id, MONDAY, workoutJson()]),
      DENIED,
    );
    await expectFailure(
      asSuperuser("insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state, source) values ($1, $2, 'bike', 'x', $3::jsonb, 'published', 'intervals')", [athlete.id, MONDAY, workoutJson()]),
      /planned_sessions_external_rules/,
    );
    await expectFailure(asSuperuser("update public.planned_sessions set source = 'tricoach', external_id = null where id = $1", [imported]), /immutable_field/);
    // Même identifiant chez intervals.icu pour le même athlète : une seule séance.
    await expectFailure(
      asSuperuser("insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state, source, external_id) values ($1, $2, 'bike', 'x', $3::jsonb, 'published', 'intervals', '81234')", [athlete.id, MONDAY, workoutJson()]),
      /planned_sessions_external/,
    );
  });

  it("aucune notification ni envoi vers la montre de la part de TriCoach", async () => {
    const notes = await asSuperuser("select count(*)::int as n from public.notifications where recipient_id = any($1)", [[athlete.id, coach.id]]);
    expect(notes.rows[0].n).toBe(0);
    const jobs = await asSuperuser("select count(*)::int as n from public.sync_jobs where athlete_id = $1 and kind in ('intervals_sync', 'suunto_sync')", [athlete.id]);
    expect(jobs.rows[0].n).toBe(0);
  });

  it("copie d'une semaine, plan et duplication : seulement les séances de TriCoach", async () => {
    await as(coach, "insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state) values ($1, $2, 'bike', 'Endurance', $3::jsonb, 'published')", [
      athlete.id,
      "2027-03-03",
      workoutJson(),
    ]);
    const { rows } = await as(coach, "select public.copy_planned_week($1, $2, '2027-03-08') as n", [athlete.id, MONDAY]);
    expect(rows[0].n).toBe(1);
    const copied = await asSuperuser("select title, source from public.planned_sessions where athlete_id = $1 and scheduled_date between '2027-03-08' and '2027-03-14'", [athlete.id]);
    expect(copied.rows).toEqual([{ title: "Endurance", source: "tricoach" }]);

    const plan = await as(coach, "select public.save_training_plan($1, $2, 1, 'Bloc') as id", [athlete.id, MONDAY]);
    const inPlan = await asSuperuser("select title from public.training_plan_sessions where plan_id = $1", [plan.rows[0].id]);
    expect(inPlan.rows).toEqual([{ title: "Endurance" }]);

    for (const user of [athlete, coach]) {
      await expectFailure(as(user, "select public.duplicate_planned_session($1, '2027-03-05')", [imported]), /imported_session_read_only/);
    }
  });
});
