/**
 * Partage des activités Strava avec un coach : autorisation expresse de l'athlète, coach par coach,
 * révocable, remise à zéro avec la relation ; lecture seule pour le coach, jusqu'à l'expiration.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSteps, asSuperuser, closeDb, createUser, expectFailure, linkCoach, workoutJson, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let otherCoach: TestUser;
let outsider: TestUser;
let coachLink: string;
let otherLink: string;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète partage Strava" });
  coach = await createUser({ name: "Coach partage Strava", coach: true });
  otherCoach = await createUser({ name: "Second coach partage", coach: true });
  outsider = await createUser({ name: "Coach extérieur partage", coach: true });
  coachLink = await linkCoach(coach, athlete);
  otherLink = await linkCoach(otherCoach, athlete);
});

afterAll(closeDb);

let dayCounter = 0;
function freshDay() {
  dayCounter += 5;
  return new Date(Date.UTC(2027, 3, 1) + dayCounter * 86_400_000).toISOString().slice(0, 10);
}

async function bikeSession(date: string) {
  const { rows } = await as(
    coach,
    `insert into public.planned_sessions (athlete_id, scheduled_date, sport, title, content, state, planned_duration_s)
     values ($1, $2, 'bike', 'Sortie partagée', $3::jsonb, 'published', 3600) returning id`,
    [athlete.id, date, workoutJson()],
  );
  return rows[0].id as string;
}

async function connection() {
  const existing = await asSuperuser("select id from public.external_connections where athlete_id = $1", [athlete.id]);
  if (existing.rowCount) return existing.rows[0].id as string;
  const { rows } = await asSuperuser(
    `insert into public.external_connections (athlete_id, provider, external_athlete_id, scopes)
     values ($1, 'strava', $2, '{read,activity:read_all}') returning id`,
    [athlete.id, String(Math.floor(Math.random() * 1e9))],
  );
  return rows[0].id as string;
}

async function stravaRide(date: string, expiresInDays = 6) {
  const { rows } = await asSuperuser(
    `insert into public.activities
       (athlete_id, source, external_id, connection_id, sport, name, start_time, local_date, moving_s, elapsed_s, fetched_at, expires_at)
     values ($1, 'strava', $2, $3, 'bike', 'Sortie Strava', ($4 || 'T08:00:00Z')::timestamptz, $4::date, 3600, 3700,
             now() + make_interval(days => $5 - 6), now() + make_interval(days => $5))
     returning id`,
    [athlete.id, String(Math.floor(Math.random() * 1e12)), await connection(), date, expiresInDays],
  );
  return rows[0].id as string;
}

const visible = async (user: TestUser, activityId: string) => {
  const activity = await as(user, "select id from public.activities where id = $1", [activityId]);
  const matches = await as(user, "select session_id from public.session_activity_matches where activity_id = $1", [activityId]);
  return { activity: activity.rowCount, matches: matches.rowCount };
};

const share = (user: TestUser, link: string, on: boolean) => as(user, "select public.set_strava_sharing($1, $2) as shared", [link, on]);

const linkState = async (link: string) =>
  (await asSuperuser("select share_strava, strava_shared_at from public.coach_athlete_links where id = $1", [link])).rows[0] as {
    share_strava: boolean;
    strava_shared_at: Date | null;
  };

describe("partage des activités Strava avec un coach", () => {
  it("sans autorisation, aucun coach ne voit l'activité Strava ni son rapprochement", async () => {
    const day = freshDay();
    const session = await bikeSession(day);
    const ride = await stravaRide(day);
    expect(await visible(athlete, ride)).toEqual({ activity: 1, matches: 1 });
    const [match] = (await as(athlete, "select session_id, status from public.session_activity_matches where activity_id = $1", [ride])).rows;
    expect(match).toEqual({ session_id: session, status: "auto" });
    expect(await visible(coach, ride)).toEqual({ activity: 0, matches: 0 });
    expect(await visible(otherCoach, ride)).toEqual({ activity: 0, matches: 0 });
    expect(await linkState(coachLink)).toEqual({ share_strava: false, strava_shared_at: null });
  });

  it("seul l'athlète donne l'autorisation, et pour un coach à la fois", async () => {
    await expectFailure(share(coach, coachLink, true), /link_not_found/);
    await expectFailure(share(outsider, coachLink, true), /link_not_found/);
    await expectFailure(share(otherCoach, coachLink, true), /link_not_found/);
    await expectFailure(as(coach, "update public.coach_athlete_links set share_strava = true, strava_shared_at = now() where id = $1", [coachLink]), /permission denied/);
    await expectFailure(as(null, "select public.set_strava_sharing($1, true)", [coachLink]), /permission denied/);
    await expectFailure(share(athlete, randomUUID(), true), /link_not_found/);

    const result = await share(athlete, coachLink, true);
    expect(result.rows[0].shared).toBe(true);
    const state = await linkState(coachLink);
    expect(state.share_strava).toBe(true);
    expect(state.strava_shared_at).toBeInstanceOf(Date);
    // Redonner son accord ne change pas la date du consentement.
    await share(athlete, coachLink, true);
    expect((await linkState(coachLink)).strava_shared_at).toEqual(state.strava_shared_at);
    expect((await linkState(otherLink)).share_strava).toBe(false);
    // Le coach voit qu'il est autorisé (sa relation), pas davantage.
    const seen = await as(coach, "select share_strava from public.coach_athlete_links where id = $1", [coachLink]);
    expect(seen.rows[0].share_strava).toBe(true);
  });

  it("le coach autorisé lit l'activité et son rapprochement jusqu'à l'expiration, sans pouvoir les modifier", async () => {
    await share(athlete, coachLink, true);
    const day = freshDay();
    const session = await bikeSession(day);
    const ride = await stravaRide(day);
    expect(await visible(coach, ride)).toEqual({ activity: 1, matches: 1 });
    expect(await visible(otherCoach, ride)).toEqual({ activity: 0, matches: 0 });
    expect(await visible(outsider, ride)).toEqual({ activity: 0, matches: 0 });

    // Lecture seule : ni détachement, ni rattachement, ni écriture directe.
    await expectFailure(as(coach, "select public.dissociate_activity($1, $2)", [session, ride]), /activity_not_found|forbidden|not_found/);
    await expectFailure(as(coach, "select public.associate_activity($1, $2)", [session, ride]), /activity_not_found|forbidden|not_found/);
    const deleted = await as(coach, "delete from public.activities where id = $1", [ride]);
    expect(deleted.rowCount).toBe(0);
    expect(await visible(athlete, ride)).toEqual({ activity: 1, matches: 1 });

    // Expirée (cache de 7 jours, effacée à 6) : plus personne ne la voit, même autorisé.
    const old = await stravaRide(freshDay(), -1);
    expect(await visible(coach, old)).toEqual({ activity: 0, matches: 0 });
    expect(await visible(athlete, old)).toEqual({ activity: 0, matches: 0 });
  });

  it("retirer le partage, ou la relation, coupe l'accès aussitôt ; l'accord est alors à redonner", async () => {
    await share(athlete, coachLink, true);
    const ride = await stravaRide(freshDay());
    expect((await visible(coach, ride)).activity).toBe(1);

    const stopped = await share(athlete, coachLink, false);
    expect(stopped.rows[0].shared).toBe(false);
    expect(await linkState(coachLink)).toEqual({ share_strava: false, strava_shared_at: null });
    expect(await visible(coach, ride)).toEqual({ activity: 0, matches: 0 });

    // Relation retirée puis rétablie par une nouvelle invitation : pas de partage tant que l'athlète ne le redonne pas.
    await share(athlete, coachLink, true);
    await as(athlete, "select public.revoke_coach_link($1)", [coachLink]);
    expect(await linkState(coachLink)).toEqual({ share_strava: false, strava_shared_at: null });
    await expectFailure(share(athlete, coachLink, true), /link_not_found/);
    const again = await linkCoach(coach, athlete);
    expect(again).toBe(coachLink);
    expect(await linkState(coachLink)).toEqual({ share_strava: false, strava_shared_at: null });
    expect(await visible(coach, ride)).toEqual({ activity: 0, matches: 0 });
  });

  it("temps réel : le canal Strava n'est ouvert qu'à l'athlète et aux coachs autorisés", async () => {
    await share(athlete, coachLink, true);
    await share(athlete, otherLink, false);
    /** Signaux d'activité reçus jusqu'ici sur chaque canal de l'athlète. */
    const signals = async () => {
      const { rows } = await asSuperuser(
        "select topic, count(*)::int as n from realtime.messages where payload ->> 'table' = 'activities' and topic like '%' || $1 group by topic",
        [athlete.id],
      );
      const count = (prefix: string) => rows.find((r) => r.topic === `${prefix}:${athlete.id}`)?.n ?? 0;
      return { self: count("self"), strava: count("strava"), athlete: count("athlete") };
    };
    const before = await signals();
    await stravaRide(freshDay());
    const after = await signals();
    expect(after.self).toBe(before.self + 1);
    expect(after.strava).toBe(before.strava + 1);
    expect(after.athlete).toBe(before.athlete);

    const canReceive = async (user: TestUser, topic: string) => {
      const [, result] = await asSteps(user, [
        { sql: "select set_config('realtime.topic', $1, true)", params: [topic] },
        { sql: "select private.can_receive_athlete_topic($1) as ok", params: [topic] },
      ]);
      return result.rows[0].ok;
    };
    expect(await canReceive(athlete, `strava:${athlete.id}`)).toBe(true);
    expect(await canReceive(coach, `strava:${athlete.id}`)).toBe(true);
    expect(await canReceive(otherCoach, `strava:${athlete.id}`)).toBe(false);
    expect(await canReceive(outsider, `strava:${athlete.id}`)).toBe(false);
    expect(await canReceive(coach, `self:${athlete.id}`)).toBe(false);

    // Plus aucun coach autorisé : plus rien sur ce canal.
    await share(athlete, coachLink, false);
    await stravaRide(freshDay());
    const last = await signals();
    expect(last.self).toBe(after.self + 1);
    expect(last.strava).toBe(after.strava);
    expect(await canReceive(coach, `strava:${athlete.id}`)).toBe(false);
  });
});
