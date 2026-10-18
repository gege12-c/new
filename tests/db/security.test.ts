/**
 * Critère de fin de la phase 1 : un coach non autorisé ne lit ni ne modifie rien.
 * On prépare un athlète avec un coach autorisé et des données dans chaque table,
 * puis on vérifie, table par table, qu'un autre coach (et un visiteur anonyme) n'y a aucun accès.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  asSuperuser,
  closeDb,
  createUser,
  DENIED,
  expectFailure,
  insertSession,
  linkCoach,
  workoutJson,
  type TestUser,
} from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let stranger: TestUser;
let sessionId: string;
let draftId: string;
let thresholdId: string;
let eventId: string;
let templateId: string;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète" });
  coach = await createUser({ name: "Coach autorisé", coach: true });
  stranger = await createUser({ name: "Coach étranger", coach: true });
  await linkCoach(coach, athlete);

  await as(athlete, "update public.athlete_profiles set main_goal = 'Qualification Kona' where user_id = $1", [athlete.id]);
  thresholdId = (
    await as(
      athlete,
      `insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from)
       values ($1, 'bike', 'ftp_w', 280, '2026-09-01') returning id`,
      [athlete.id],
    )
  ).rows[0].id;
  eventId = (
    await as(
      coach,
      `insert into public.athlete_events (athlete_id, name, event_date, priority)
       values ($1, 'Ironman Nice', '2027-06-27', 'A') returning id`,
      [athlete.id],
    )
  ).rows[0].id;
  sessionId = (await insertSession(coach, athlete, { state: "published" })).id;
  draftId = (await insertSession(coach, athlete, { state: "draft", title: "Brouillon" })).id;
  templateId = (
    await as(
      coach,
      `insert into public.workout_templates (name, sport, content) values ('Seuil', 'bike', $1::jsonb) returning id`,
      [workoutJson()],
    )
  ).rows[0].id;
});

afterAll(closeDb);

const athleteTables = [
  { table: "profiles", where: "id = $1" },
  { table: "athlete_profiles", where: "user_id = $1" },
  { table: "athlete_thresholds", where: "athlete_id = $1" },
  { table: "athlete_events", where: "athlete_id = $1" },
  { table: "planned_sessions", where: "athlete_id = $1" },
  { table: "coach_athlete_links", where: "athlete_id = $1" },
  { table: "audit_logs", where: "athlete_id = $1" },
];

describe("coach autorisé (témoin)", () => {
  it("lit toutes les données de son athlète", async () => {
    for (const { table, where } of athleteTables) {
      const { rowCount } = await as(coach, `select 1 from public.${table} where ${where}`, [athlete.id]);
      expect(rowCount, table).toBeGreaterThan(0);
    }
  });
});

describe("coach non autorisé", () => {
  it("ne lit aucune donnée de l'athlète", async () => {
    for (const { table, where } of athleteTables) {
      const { rowCount } = await as(stranger, `select 1 from public.${table} where ${where}`, [athlete.id]);
      expect(rowCount, table).toBe(0);
    }
    const thresholds = await as(stranger, "select * from public.athlete_thresholds_at($1, '2026-12-31')", [athlete.id]);
    expect(thresholds.rowCount).toBe(0);
  });

  it("ne voit pas les modèles d'un autre coach", async () => {
    const { rowCount } = await as(stranger, "select 1 from public.workout_templates where id = $1", [templateId]);
    expect(rowCount).toBe(0);
  });

  it("ne crée rien pour l'athlète", async () => {
    await expectFailure(
      as(
        stranger,
        `insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content)
         values ($1, '2026-11-03', 'bike', 'Intrusion', $2::jsonb)`,
        [athlete.id, workoutJson()],
      ),
      DENIED,
    );
    await expectFailure(
      as(
        stranger,
        `insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from)
         values ($1, 'bike', 'ftp_w', 400, '2026-10-01')`,
        [athlete.id],
      ),
      DENIED,
    );
    await expectFailure(
      as(stranger, "insert into public.athlete_events (athlete_id, name, event_date) values ($1, 'Faux', '2027-01-01')", [
        athlete.id,
      ]),
      DENIED,
    );
    await expectFailure(
      as(stranger, "insert into public.athlete_profiles (user_id, main_goal) values ($1, 'Piraté')", [athlete.id]),
      DENIED,
    );
  });

  it("ne modifie ni ne supprime rien", async () => {
    const attempts: [string, unknown[]][] = [
      ["update public.planned_sessions set title = 'Piraté' where id = $1", [sessionId]],
      ["update public.planned_sessions set state = 'published' where id = $1", [draftId]],
      ["delete from public.planned_sessions where id = $1", [sessionId]],
      ["update public.athlete_thresholds set value = 999 where id = $1", [thresholdId]],
      ["delete from public.athlete_thresholds where id = $1", [thresholdId]],
      ["update public.athlete_events set name = 'Piraté' where id = $1", [eventId]],
      ["delete from public.athlete_events where id = $1", [eventId]],
      ["update public.athlete_profiles set main_goal = 'Piraté' where user_id = $1", [athlete.id]],
      ["update public.profiles set display_name = 'Piraté' where id = $1", [athlete.id]],
      ["update public.workout_templates set name = 'Piraté' where id = $1", [templateId]],
      ["delete from public.workout_templates where id = $1", [templateId]],
    ];
    for (const [sql, params] of attempts) {
      const { rowCount } = await as(stranger, sql, params);
      expect(rowCount, sql).toBe(0);
    }

    // Vérification à la source : rien n'a bougé.
    const state = await asSuperuser(
      `select
         (select title from public.planned_sessions where id = $1) as title,
         (select state from public.planned_sessions where id = $2) as draft_state,
         (select value::int from public.athlete_thresholds where id = $3) as ftp,
         (select name from public.athlete_events where id = $4) as event,
         (select main_goal from public.athlete_profiles where user_id = $5) as goal,
         (select display_name from public.profiles where id = $5) as name,
         (select name from public.workout_templates where id = $6) as template`,
      [sessionId, draftId, thresholdId, eventId, athlete.id, templateId],
    );
    expect(state.rows[0]).toEqual({
      title: "Seuil 4 × 8 min",
      draft_state: "draft",
      ftp: 280,
      event: "Ironman Nice",
      goal: "Qualification Kona",
      name: "Athlète",
      template: "Seuil",
    });
  });

  it("ne peut ni s'octroyer l'accès ni agir sur la relation d'un autre", async () => {
    const link = await asSuperuser("select id from public.coach_athlete_links where athlete_id = $1", [athlete.id]);
    await expectFailure(as(stranger, "select public.revoke_coach_link($1)", [link.rows[0].id]), /link_not_found/);
    await expectFailure(as(stranger, "select public.set_coach_permissions($1, true, true)", [link.rows[0].id]), /link_not_found/);
    await expectFailure(
      as(stranger, "update public.coach_athlete_links set coach_id = $1 where athlete_id = $2", [stranger.id, athlete.id]),
      DENIED,
    );
  });

  it("ne peut pas se déclarer administrateur", async () => {
    await expectFailure(as(stranger, "insert into public.admin_users (user_id) values ($1)", [stranger.id]), DENIED);
    const isAdmin = await as(stranger, "select public.current_user_is_admin() as admin");
    expect(isAdmin.rows[0].admin).toBe(false);
  });
});

describe("coach en lecture seule", () => {
  it("lit mais ne planifie plus quand l'athlète retire le droit de planifier", async () => {
    const limitedAthlete = await createUser({ name: "Athlète prudent" });
    const limitedCoach = await createUser({ name: "Coach limité", coach: true });
    const linkId = await linkCoach(limitedCoach, limitedAthlete);
    const session = await insertSession(limitedCoach, limitedAthlete);
    await as(limitedAthlete, "select public.set_coach_permissions($1, false, true)", [linkId]);

    expect((await as(limitedCoach, "select 1 from public.planned_sessions where id = $1", [session.id])).rowCount).toBe(1);
    expect((await as(limitedCoach, "update public.planned_sessions set title = 'Non' where id = $1", [session.id])).rowCount).toBe(0);
    expect((await as(limitedCoach, "delete from public.planned_sessions where id = $1", [session.id])).rowCount).toBe(0);
    await expectFailure(insertSession(limitedCoach, limitedAthlete), DENIED);
  });
});

describe("visiteur anonyme", () => {
  it("n'a accès à aucune table", async () => {
    for (const { table } of athleteTables) {
      await expectFailure(as(null, `select 1 from public.${table}`), DENIED);
    }
    await expectFailure(as(null, "select 1 from public.invitations"), DENIED);
    await expectFailure(as(null, "select 1 from public.workout_templates"), DENIED);
  });
});

describe("administrateur", () => {
  it("voit les comptes mais pas les données sportives", async () => {
    const admin = await createUser({ name: "Admin" });
    await asSuperuser("insert into public.admin_users (user_id) values ($1)", [admin.id]);
    expect((await as(admin, "select 1 from public.profiles where id = $1", [athlete.id])).rowCount).toBe(1);
    // Chaque compte a son propre profil sportif : on vérifie l'accès aux données des autres.
    const sportsData = [
      { table: "athlete_profiles", owner: "user_id" },
      { table: "athlete_thresholds", owner: "athlete_id" },
      { table: "athlete_events", owner: "athlete_id" },
      { table: "planned_sessions", owner: "athlete_id" },
      { table: "audit_logs", owner: "athlete_id" },
    ];
    for (const { table, owner } of sportsData) {
      const { rowCount } = await as(admin, `select 1 from public.${table} where ${owner} is distinct from $1`, [admin.id]);
      expect(rowCount, table).toBe(0);
    }
  });
});
