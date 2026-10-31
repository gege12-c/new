/**
 * Plans d'entraînement : semaines d'un athlète enregistrées en plan par son coach (séances annulées
 * exclues), puis appliquées à un athlète à partir d'un lundi, en brouillon ou publiées, avec les
 * droits de planification de l'appelant ; bibliothèque privée de chaque coach.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeDb, createUser, expectFailure, linkCoach, workoutJson, type TestUser } from "./helpers";

let coach: TestUser;
let athlete: TestUser;
let second: TestUser;
let watcher: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  coach = await createUser({ name: "Coach plans", coach: true });
  athlete = await createUser({ name: "Athlète plans" });
  second = await createUser({ name: "Deuxième athlète plans" });
  watcher = await createUser({ name: "Coach lecteur plans", coach: true });
  stranger = await createUser({ name: "Coach étranger plans", coach: true });
  await linkCoach(coach, athlete);
  await linkCoach(coach, second);
  const link = await linkCoach(watcher, second);
  await as(second, "select public.set_coach_permissions($1, false, true)", [link]);
});

afterAll(closeDb);

const MONDAY = "2027-03-01";
async function session(date: string, state = "published", title = "Séance") {
  await as(
    coach,
    `insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state, planned_duration_s) values ($1, $2, 'bike', $3, $4::jsonb, $5, 3600)`,
    [athlete.id, date, title, workoutJson(), state],
  );
}

describe("plans d'entraînement", () => {
  let plan = "";

  it("deux semaines enregistrées en plan, sans les séances annulées, au bon jour", async () => {
    await session("2027-03-01", "published", "Lundi");
    await session("2027-03-03", "draft", "Mercredi");
    await session("2027-03-04", "published", "Annulée");
    await as(coach, "update public.planned_sessions set state = 'cancelled' where athlete_id = $1 and title = 'Annulée'", [athlete.id]);
    await session("2027-03-10", "published", "Semaine 2");
    await session("2027-03-15", "published", "Hors plan");
    plan = (await as(coach, "select public.save_training_plan($1, $2, 2, ' Bloc seuil ', 'Deux semaines') as id", [athlete.id, MONDAY])).rows[0].id;
    const rows = (await as(coach, "select day_offset, title from public.training_plan_sessions where plan_id = $1 order by day_offset", [plan])).rows;
    expect(rows).toEqual([
      { day_offset: 0, title: "Lundi" },
      { day_offset: 2, title: "Mercredi" },
      { day_offset: 9, title: "Semaine 2" },
    ]);
    expect((await as(coach, "select name, weeks from public.training_plans where id = $1", [plan])).rows).toEqual([{ name: "Bloc seuil", weeks: 2 }]);
  });

  it("appliqué à un autre athlète à partir d'un lundi, en brouillon puis publié", async () => {
    const count = (await as(coach, "select public.apply_training_plan($1, $2, '2027-04-05') as n", [plan, second.id])).rows[0].n;
    expect(count).toBe(3);
    const created = (await as(coach, "select scheduled_date::text as d, state from public.planned_sessions where athlete_id = $1 order by scheduled_date", [second.id])).rows;
    expect(created).toEqual([
      { d: "2027-04-05", state: "draft" },
      { d: "2027-04-07", state: "draft" },
      { d: "2027-04-14", state: "draft" },
    ]);
    expect((await as(coach, "select public.apply_training_plan($1, $2, '2027-05-03', true) as n", [plan, second.id])).rows[0].n).toBe(3);
    // Publiées : l'athlète les voit.
    expect((await as(second, "select count(*)::int as n from public.planned_sessions where scheduled_date >= '2027-05-03'")).rows[0].n).toBe(3);
  });

  it("refus : un lundi exigé, une période vide, un athlète inaccessible, un coach qui ne planifie pas", async () => {
    await expectFailure(as(coach, "select public.save_training_plan($1, '2027-03-02', 1, 'X')", [athlete.id]), /week_must_start_monday/);
    await expectFailure(as(coach, "select public.save_training_plan($1, '2027-08-02', 1, 'Vide')", [athlete.id]), /empty_plan/);
    await expectFailure(as(stranger, "select public.save_training_plan($1, $2, 1, 'Volé')", [athlete.id, MONDAY]), /athlete_not_found/);
    await expectFailure(as(coach, "select public.apply_training_plan($1, $2, '2027-04-06')", [plan, second.id]), /week_must_start_monday/);
  });

  it("bibliothèque privée : un autre coach ne voit ni n'applique le plan", async () => {
    expect((await as(stranger, "select count(*)::int as n from public.training_plans")).rows[0].n).toBe(0);
    await expectFailure(as(watcher, "select public.apply_training_plan($1, $2, '2027-06-07')", [plan, second.id]), /plan_not_found/);
    // Son propre plan, mais sans droit de planifier pour cet athlète.
    const own = (await as(watcher, "insert into public.training_plans (name, weeks) values ('Plan du lecteur', 1) returning id")).rows[0].id;
    await as(watcher, "insert into public.training_plan_sessions (plan_id, day_offset, sport, title, content) values ($1, 0, 'run', 'Footing', $2::jsonb)", [own, workoutJson()]);
    await expectFailure(as(watcher, "select public.apply_training_plan($1, $2, '2027-06-07')", [own, second.id]), /session_not_editable/);
  });
});
