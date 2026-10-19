import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, insertSession, linkCoach, workoutJson, type TestUser } from "./helpers";

let coach: TestUser;
let otherCoach: TestUser;
let athlete: TestUser;
let neighbour: TestUser;
let published: { id: string };
let coachDraft: { id: string };
let own: { id: string };

async function count(sql: string, params: unknown[] = []) {
  return Number((await asSuperuser(sql, params)).rows[0].count);
}

beforeAll(async () => {
  coach = await createUser({ name: "Coach qui part", coach: true });
  otherCoach = await createUser({ name: "Coach qui reste", coach: true });
  athlete = await createUser({ name: "Athlète qui part" });
  neighbour = await createUser({ name: "Voisin" });
  await linkCoach(coach, athlete);
  await linkCoach(otherCoach, athlete);

  const template = await as(coach, "insert into public.workout_templates (name, sport, content) values ('Seuil', 'bike', $1::jsonb) returning id", [workoutJson()]);
  published = await insertSession(coach, athlete, { title: "Seuil publié", date: "2026-11-02" });
  await asSuperuser("update public.planned_sessions set template_id = $2 where id = $1", [published.id, template.rows[0].id]);
  coachDraft = await insertSession(coach, athlete, { state: "draft", title: "Brouillon du coach" });
  own = await insertSession(athlete, athlete, { title: "Ma sortie", date: "2026-11-03" });
  await as(coach, `insert into public.planned_session_drafts (session_id, payload) values ($1, '{"title": "Seuil modifié"}')`, [published.id]);

  await as(coach, "insert into public.session_comments (session_id, body) values ($1, 'Bien récupérer')", [published.id]);
  await as(coach, "insert into public.session_comments (session_id, body, visibility) values ($1, 'Note pour moi', 'coach_private')", [published.id]);
  await as(athlete, "insert into public.session_comments (session_id, body) values ($1, 'Jambes lourdes')", [published.id]);
  await as(otherCoach, "insert into public.session_comments (session_id, body) values ($1, 'Bravo')", [published.id]);

  await as(athlete, "insert into public.session_completions (session_id, status, rpe) values ($1, 'done', 6)", [published.id]);
  await as(
    athlete,
    `insert into public.activities (source, external_id, sport, start_time, local_date, moving_s, elapsed_s)
     values ('fit_upload', $1, 'bike', '2026-11-02T06:00:00Z', '2026-11-02', 3600, 3600)`,
    [randomUUID()],
  );
  await as(athlete, "insert into public.athlete_thresholds (athlete_id, sport, metric, value, effective_from) values ($1, 'bike', 'ftp_w', 250, '2026-01-01')", [athlete.id]);
  await as(coach, "insert into public.athlete_events (athlete_id, name, event_date) values ($1, 'Triathlon de Nice', '2027-06-01')", [athlete.id]);
  await as(athlete, "insert into public.workout_exports (session_id, provider, format, session_version, status, error) values ($1, 'zwift', 'zwo', 1, 'failed', 'x')", [published.id]);
  await as(athlete, "insert into public.notification_preferences (user_id, disabled_kinds) values ($1, '{comment}')", [athlete.id]);
  await as(coach, "select * from public.create_invitation($1)", ["futur-athlete@test.local"]);
});

afterAll(closeDb);

describe("suppression de son compte", () => {
  it("réservée à l'utilisateur connecté, pour son seul compte", async () => {
    await expectFailure(as(null, "select public.delete_my_account()"), DENIED);
    const signature = await asSuperuser(
      "select pg_get_function_identity_arguments('public.delete_my_account'::regproc) as args, prosecdef from pg_proc where proname = 'delete_my_account'",
    );
    // Aucun paramètre : impossible de viser le compte de quelqu'un d'autre.
    expect(signature.rows[0]).toEqual({ args: "", prosecdef: true });
  });

  it("un coach part : les séances publiées restent chez l'athlète, sans auteur ; son travail non publié disparaît", async () => {
    const athleteInbox = await count("select count(*) from public.notifications where recipient_id = $1", [athlete.id]);
    await as(coach, "select public.delete_my_account()");

    expect(await count("select count(*) from auth.users where id = $1", [coach.id])).toBe(0);
    expect(await count("select count(*) from public.profiles where id = $1", [coach.id])).toBe(0);
    const session = await asSuperuser("select created_by, updated_by, template_id, state, title from public.planned_sessions where id = $1", [published.id]);
    expect(session.rows).toEqual([{ created_by: null, updated_by: null, template_id: null, state: "published", title: "Seuil publié" }]);
    expect(await count("select count(*) from public.planned_sessions where id = $1", [coachDraft.id])).toBe(0);
    expect(await count("select count(*) from public.planned_session_drafts where session_id = $1", [published.id])).toBe(0);
    expect(await count("select count(*) from public.workout_templates where owner_id = $1", [coach.id])).toBe(0);
    expect(await count("select count(*) from public.invitations where coach_id = $1", [coach.id])).toBe(0);
    expect(await count("select count(*) from public.coach_athlete_links where coach_id = $1", [coach.id])).toBe(0);
    expect(await count("select count(*) from public.session_comments where author_id = $1", [coach.id])).toBe(0);
    // Les commentaires des autres restent.
    expect(await count("select count(*) from public.session_comments where session_id = $1", [published.id])).toBe(2);
    expect(await count("select count(*) from public.athlete_events where athlete_id = $1 and created_by is null", [athlete.id])).toBe(1);
    // Historique anonymisé, aucune notification déclenchée par la suppression.
    expect(await count("select count(*) from public.audit_logs where actor_id = $1", [coach.id])).toBe(0);
    expect(await count("select count(*) from public.audit_logs where entity_type = 'invitations' and changes ->> 'coach_id' = $1", [coach.id])).toBe(0);
    expect(await count("select count(*) from public.notifications where recipient_id = $1", [athlete.id])).toBe(athleteInbox);

    // L'athlète et l'autre coach retrouvent la séance, qui reste modifiable.
    expect((await as(athlete, "select title from public.planned_sessions where id = $1", [published.id])).rows).toEqual([{ title: "Seuil publié" }]);
    expect((await as(otherCoach, "select title from public.planned_sessions where id = $1", [published.id])).rowCount).toBe(1);
    await as(otherCoach, "update public.planned_sessions set title = 'Seuil repris' where id = $1", [published.id]);
    expect((await asSuperuser("select updated_by from public.planned_sessions where id = $1", [published.id])).rows[0].updated_by).toBe(otherCoach.id);

    // Le jeton de l'ancien compte ne permet plus rien.
    await expectFailure(as(coach, "select public.delete_my_account()"), /account_not_found/);
  });

  it("une athlète part : plus rien ne la concerne, nulle part", async () => {
    await as(athlete, "select public.delete_my_account()");

    for (const table of [
      "planned_sessions",
      "planned_session_drafts",
      "session_comments",
      "session_completions",
      "activities",
      "session_activity_matches",
      "workout_exports",
      "notifications",
      "athlete_thresholds",
      "athlete_events",
      "coach_athlete_links",
      "sync_jobs",
      "audit_logs",
    ]) {
      expect(await count(`select count(*) from public.${table} where athlete_id = $1`, [athlete.id]), table).toBe(0);
    }
    expect(await count("select count(*) from public.planned_sessions where id = any ($1)", [[published.id, own.id]])).toBe(0);
    expect(await count("select count(*) from public.notifications where recipient_id = $1", [athlete.id])).toBe(0);
    expect(await count("select count(*) from public.notification_preferences where user_id = $1", [athlete.id])).toBe(0);
    expect(await count("select count(*) from public.athlete_profiles where user_id = $1", [athlete.id])).toBe(0);
    expect(await count("select count(*) from public.invitations where accepted_by = $1", [athlete.id])).toBe(0);
    // Aucune trace de son identifiant dans l'historique, même dans le détail des changements.
    expect(await count("select count(*) from public.audit_logs where actor_id = $1 or changes::text like '%' || $1 || '%'", [athlete.id])).toBe(0);

    // L'autre coach garde son compte ; ce qui le prévenait au sujet de l'athlète a disparu.
    expect(await count("select count(*) from public.profiles where id = $1", [otherCoach.id])).toBe(1);
    expect(await count("select count(*) from public.notifications where recipient_id = $1 and athlete_id = $2", [otherCoach.id, athlete.id])).toBe(0);
  });

  it("une connexion Strava et ses jetons partent avec le compte", async () => {
    const { rows } = await asSuperuser(
      `insert into public.external_connections (athlete_id, provider, external_athlete_id, scopes)
       values ($1, 'strava', $2, '{read,activity:read_all}') returning id`,
      [neighbour.id, String(Math.floor(Math.random() * 1e9))],
    );
    await asSuperuser("insert into public.oauth_tokens (connection_id, access_token, refresh_token, expires_at) values ($1, 'v1.a', 'v1.r', now())", [rows[0].id]);
    await as(neighbour, "select public.delete_my_account()");
    expect(await count("select count(*) from public.external_connections where id = $1", [rows[0].id])).toBe(0);
    expect(await count("select count(*) from public.oauth_tokens where connection_id = $1", [rows[0].id])).toBe(0);
    expect(await count("select count(*) from public.profiles where id = $1", [otherCoach.id])).toBe(1);
  });
});
