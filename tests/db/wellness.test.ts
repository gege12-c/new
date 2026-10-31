/**
 * Forme du jour : écrite par l'athlète seul (une ligne par jour), lue par lui et par les coachs qu'il
 * autorise à voir ses activités ; valeurs bornées, ligne vide refusée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closeDb, createUser, expectFailure, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let blind: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète forme" });
  coach = await createUser({ name: "Coach forme", coach: true });
  blind = await createUser({ name: "Coach sans activités forme", coach: true });
  stranger = await createUser({ name: "Coach étranger forme", coach: true });
  await linkCoach(coach, athlete);
  const link = await linkCoach(blind, athlete);
  await as(athlete, "select public.set_coach_permissions($1, true, false)", [link]);
});

afterAll(closeDb);

describe("forme du jour", () => {
  it("l'athlète saisit sa journée, puis la corrige ; une seule ligne par jour", async () => {
    await as(athlete, "insert into public.wellness_entries (entry_date, fatigue, sleep_hours, resting_hr) values ('2027-01-10', 4, 5.5, 52)");
    await expectFailure(as(athlete, "insert into public.wellness_entries (entry_date, fatigue) values ('2027-01-10', 2)"), /duplicate key|wellness_entries_pkey/);
    const updated = await as(athlete, "update public.wellness_entries set fatigue = 2, note = 'Mieux après la sieste' where entry_date = '2027-01-10' returning fatigue");
    expect(updated.rows).toEqual([{ fatigue: 2 }]);
  });

  it("lue par l'athlète et le coach qu'il autorise à voir ses activités, jamais par les autres", async () => {
    const sees = async (user: TestUser) =>
      (await as(user, "select count(*)::int as n from public.wellness_entries where athlete_id = $1", [athlete.id])).rows[0].n;
    expect(await sees(athlete)).toBe(1);
    expect(await sees(coach)).toBe(1);
    expect(await sees(blind)).toBe(0);
    expect(await sees(stranger)).toBe(0);
  });

  it("personne d'autre ne l'écrit ni ne la modifie", async () => {
    await expectFailure(as(coach, "insert into public.wellness_entries (athlete_id, entry_date, fatigue) values ($1, '2027-01-11', 3)", [athlete.id]), /permission denied/);
    expect((await as(coach, "update public.wellness_entries set fatigue = 5 where athlete_id = $1 returning 1", [athlete.id])).rowCount).toBe(0);
    expect((await as(coach, "delete from public.wellness_entries where athlete_id = $1 returning 1", [athlete.id])).rowCount).toBe(0);
  });

  it("valeurs bornées et ligne vide refusées", async () => {
    await expectFailure(as(athlete, "insert into public.wellness_entries (entry_date, fatigue) values ('2027-01-12', 6)"), /wellness_entries_fatigue_check/);
    await expectFailure(as(athlete, "insert into public.wellness_entries (entry_date, resting_hr) values ('2027-01-12', 12)"), /wellness_entries_resting_hr_check/);
    await expectFailure(as(athlete, "insert into public.wellness_entries (entry_date) values ('2027-01-12')"), /wellness_entries_not_empty/);
  });
});
