import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brick } from "@/lib/workout/fixtures";
import { as, asSteps, asSuperuser, closeDb, createUser, DENIED, expectFailure, linkCoach, workoutJson, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let viewerLink: string;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète activités" });
  coach = await createUser({ name: "Coach activités", coach: true });
  viewer = await createUser({ name: "Coach sans activités", coach: true });
  outsider = await createUser({ name: "Coach extérieur activités", coach: true });
  await linkCoach(coach, athlete);
  viewerLink = await linkCoach(viewer, athlete);
  // Ce coach planifie, mais l'athlète ne l'autorise pas à voir ses activités.
  await as(athlete, "select public.set_coach_permissions($1, true, false)", [viewerLink]);
});

afterAll(closeDb);

let dayCounter = 0;
/** Une date différente pour chaque scénario : les rapprochements d'un test ne se mêlent pas aux autres. */
function freshDay() {
  dayCounter += 5;
  const date = new Date(Date.UTC(2027, 0, 1) + dayCounter * 86_400_000);
  return date.toISOString().slice(0, 10);
}
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const runWorkout = (seconds: number) =>
  JSON.stringify({
    schemaVersion: 1,
    segments: [{ id: "s", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds } }] }],
  });

async function insertSession(options: {
  date: string;
  sport?: "bike" | "run" | "brick";
  time?: string | null;
  duration?: number | null;
  state?: "draft" | "published" | "cancelled";
  author?: TestUser;
}) {
  const sport = options.sport ?? "bike";
  const content = sport === "brick" ? JSON.stringify(brick) : sport === "run" ? runWorkout(options.duration ?? 3600) : workoutJson();
  const { rows } = await as(
    options.author ?? coach,
    `insert into public.planned_sessions (athlete_id, scheduled_date, start_time, sport, title, content, state, planned_duration_s)
     values ($1, $2, $3, $4, 'Séance', $5::jsonb, $6, $7) returning id`,
    [athlete.id, options.date, options.time ?? null, sport, content, options.state ?? "published", options.duration ?? 3600],
  );
  return rows[0].id as string;
}

async function stravaConnection(user: TestUser = athlete) {
  const existing = await asSuperuser("select id from public.external_connections where athlete_id = $1", [user.id]);
  if (existing.rowCount) return existing.rows[0].id as string;
  const { rows } = await asSuperuser(
    `insert into public.external_connections (athlete_id, provider, external_athlete_id, scopes)
     values ($1, 'strava', $2, '{read,activity:read_all}') returning id`,
    [user.id, String(Math.floor(Math.random() * 1e9))],
  );
  return rows[0].id as string;
}

async function insertStrava(options: { date: string; sport?: string; time?: string | null; moving?: number; expiresInDays?: number }) {
  const connection = await stravaConnection();
  const { rows } = await asSuperuser(
    `insert into public.activities
       (athlete_id, source, external_id, connection_id, sport, start_time, local_date, local_start_time, moving_s, elapsed_s, expires_at)
     values ($1, 'strava', $2, $3, $4, ($5 || 'T06:00:00Z')::timestamptz, $5::date, $6, $7, $7, now() + make_interval(days => $8))
     returning id`,
    [athlete.id, String(Math.floor(Math.random() * 1e12)), connection, options.sport ?? "bike", options.date, options.time ?? null, options.moving ?? 3600, options.expiresInDays ?? 6],
  );
  return rows[0].id as string;
}

async function insertFit(options: { date: string; sport?: string; time?: string | null; moving?: number; user?: TestUser }) {
  const { rows } = await as(
    options.user ?? athlete,
    `insert into public.activities (source, external_id, sport, start_time, local_date, local_start_time, moving_s, elapsed_s)
     values ('fit_upload', $1, $2, ($3 || 'T06:00:00Z')::timestamptz, $3::date, $4, $5, $5) returning id`,
    [randomUUID(), options.sport ?? "bike", options.date, options.time ?? null, options.moving ?? 3600],
  );
  return rows[0].id as string;
}

const matchesOf = async (activityId: string) =>
  (await asSuperuser("select session_id, status, score from public.session_activity_matches where activity_id = $1 order by score desc", [activityId])).rows as {
    session_id: string;
    status: string;
    score: string;
  }[];

describe("note de correspondance", () => {
  const score = async (args: unknown[]) =>
    (await asSuperuser("select private.match_score($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as s", args)).rows[0].s;

  it("filtre la discipline et la date, compare l'heure et la durée", async () => {
    const same = await score(["bike", "2027-03-01", null, 3600, null, "bike", false, "2027-03-01", null, 3600, null]);
    expect(Number(same.score)).toBeGreaterThan(0.9);
    expect(Number((await score(["run", "2027-03-01", null, 3600, null, "bike", false, "2027-03-01", null, 3600, null])).score)).toBe(0);
    expect(Number((await score(["bike", "2027-03-03", null, 3600, null, "bike", false, "2027-03-01", null, 3600, null])).score)).toBe(0);
    const nextDay = await score(["bike", "2027-03-02", null, 3600, null, "bike", false, "2027-03-01", null, 3600, null]);
    expect(Number(nextDay.score)).toBeLessThan(0.68);
    const half = await score(["bike", "2027-03-01", null, 1800, null, "bike", false, "2027-03-01", null, 3600, null]);
    expect(Number(half.score)).toBeGreaterThanOrEqual(0.68);
    expect(Number(half.ratio)).toBe(0.5);
    const late = await score(["bike", "2027-03-01", "18:00", 3600, null, "bike", false, "2027-03-01", "07:00", 3600, null]);
    expect(Number(late.score)).toBeLessThan(Number(same.score));
  });
});

describe("rapprochement automatique", () => {
  it("rattache une activité à la séance du jour, et propose quand c'est moins sûr", async () => {
    const day = freshDay();
    const session = await insertSession({ date: day, duration: 3600 });
    const activity = await insertFit({ date: day, moving: 3500 });
    expect(await matchesOf(activity)).toMatchObject([{ session_id: session, status: "auto" }]);

    // Faite le lendemain, sans autre séance : proposée, pas rattachée d'office.
    const otherDay = freshDay();
    const moved = await insertSession({ date: otherDay, duration: 3600 });
    const late = await insertFit({ date: shift(otherDay, 1), moving: 3600 });
    expect(await matchesOf(late)).toMatchObject([{ session_id: moved, status: "proposed" }]);
  });

  it("distingue deux séances du même jour par l'heure et la durée", async () => {
    const day = freshDay();
    const morning = await insertSession({ date: day, sport: "run", time: "07:00", duration: 2700 });
    const evening = await insertSession({ date: day, sport: "run", time: "18:00", duration: 3600 });
    const first = await insertFit({ date: day, sport: "run", time: "07:05", moving: 2760 });
    const second = await insertFit({ date: day, sport: "run", time: "18:10", moving: 3720 });
    expect(await matchesOf(first)).toMatchObject([{ session_id: morning, status: "auto" }]);
    expect(await matchesOf(second)).toMatchObject([{ session_id: evening, status: "auto" }]);
  });

  it("sans heure, une seule activité pour deux séances proches reste à valider ; la seconde activité tranche", async () => {
    const day = freshDay();
    const short = await insertSession({ date: day, sport: "run", duration: 2700 });
    const long = await insertSession({ date: day, sport: "run", duration: 3600 });
    const first = await insertFit({ date: day, sport: "run", moving: 2760 });
    const proposals = await matchesOf(first);
    expect(proposals.map((m) => m.status)).toEqual(["proposed", "proposed"]);

    const second = await insertFit({ date: day, sport: "run", moving: 3720 });
    expect(await matchesOf(first)).toMatchObject([{ session_id: short, status: "auto" }]);
    expect(await matchesOf(second)).toMatchObject([{ session_id: long, status: "auto" }]);
  });

  it("rattache le vélo et la course à un enchaînement", async () => {
    const day = freshDay();
    const session = await insertSession({ date: day, sport: "brick", time: "08:00" });
    const bike = await insertFit({ date: day, sport: "bike", time: "08:02", moving: 3600 });
    const run = await insertFit({ date: day, sport: "run", time: "09:05", moving: 1250 });
    expect(await matchesOf(bike)).toMatchObject([{ session_id: session, status: "auto" }]);
    expect(await matchesOf(run)).toMatchObject([{ session_id: session, status: "auto" }]);
  });

  it("ignore les brouillons du coach et les séances annulées", async () => {
    const day = freshDay();
    await insertSession({ date: day, state: "draft" });
    await insertSession({ date: day, state: "cancelled" });
    const activity = await insertFit({ date: day });
    expect(await matchesOf(activity)).toEqual([]);
  });

  it("suit le déplacement d'une séance", async () => {
    const day = freshDay();
    const session = await insertSession({ date: day });
    const activity = await insertFit({ date: shift(day, 1) });
    expect(await matchesOf(activity)).toMatchObject([{ status: "proposed" }]);
    await as(coach, "update public.planned_sessions set scheduled_date = $2 where id = $1", [session, shift(day, 1)]);
    expect(await matchesOf(activity)).toMatchObject([{ session_id: session, status: "auto" }]);
  });
});

describe("décisions de l'athlète", () => {
  it("ne sont jamais défaites par le rapprochement automatique", async () => {
    const day = freshDay();
    const planned = await insertSession({ date: day });
    const other = await insertSession({ date: day, duration: 5400 });
    const activity = await insertFit({ date: day, moving: 3600 });
    expect(await matchesOf(activity)).toMatchObject([{ session_id: planned, status: "auto" }]);

    // L'athlète la rattache plutôt à l'autre séance.
    await as(athlete, "select public.associate_activity($1, $2)", [other, activity]);
    let matches = await matchesOf(activity);
    expect(matches.find((m) => m.session_id === other)?.status).toBe("confirmed");
    expect(matches.find((m) => m.session_id === planned)?.status).toBe("rejected");

    // Une nouvelle activité le même jour ne remet pas en cause la décision.
    await insertFit({ date: day, moving: 3000 });
    matches = await matchesOf(activity);
    expect(matches.find((m) => m.session_id === other)?.status).toBe("confirmed");

    // Détachée : la paire est écartée pour de bon.
    await as(athlete, "select public.dissociate_activity($1, $2)", [other, activity]);
    matches = await matchesOf(activity);
    expect(matches.filter((m) => m.status === "auto" || m.status === "confirmed")).toEqual([]);
  });

  it("restent réservées à l'athlète et aux coachs autorisés", async () => {
    const day = freshDay();
    const session = await insertSession({ date: day });
    const fit = await insertFit({ date: day });
    const strava = await insertStrava({ date: day });
    // Coach autorisé : il peut corriger un import FIT, jamais une activité Strava.
    await as(coach, "select public.dissociate_activity($1, $2)", [session, fit]);
    await expectFailure(as(coach, "select public.associate_activity($1, $2)", [session, strava]), /activity_not_found/);
    await expectFailure(as(viewer, "select public.associate_activity($1, $2)", [session, fit]), /activity_not_found/);
    await expectFailure(as(outsider, "select public.dissociate_activity($1, $2)", [session, fit]), /activity_not_found/);
    // Écriture directe interdite.
    await expectFailure(as(athlete, "update public.session_activity_matches set status = 'confirmed' where activity_id = $1", [fit]), DENIED);
  });
});

describe("règles Strava", () => {
  it("une activité Strava n'est visible que de son athlète, une activité FIT des coachs autorisés", async () => {
    const day = freshDay();
    await insertSession({ date: day });
    const strava = await insertStrava({ date: day });
    const fit = await insertFit({ date: shift(day, 3) });
    const sees = async (user: TestUser, id: string) =>
      (await as(user, "select 1 from public.activities where id = $1", [id])).rowCount;
    const seesMatch = async (user: TestUser, id: string) =>
      (await as(user, "select 1 from public.session_activity_matches where activity_id = $1", [id])).rowCount;

    expect(await sees(athlete, strava)).toBe(1);
    expect(await seesMatch(athlete, strava)).toBe(1);
    expect(await sees(coach, strava)).toBe(0);
    expect(await seesMatch(coach, strava)).toBe(0);

    expect(await sees(coach, fit)).toBe(1);
    expect(await sees(viewer, fit)).toBe(0);
    expect(await sees(outsider, fit)).toBe(0);
  });

  it("une activité Strava expirée disparaît aussitôt, puis est effacée", async () => {
    const day = freshDay();
    const expired = await insertStrava({ date: day, expiresInDays: -1 });
    expect((await as(athlete, "select 1 from public.activities where id = $1", [expired])).rowCount).toBe(0);
    const purged = await asSuperuser("select public.run_maintenance() as r");
    expect(purged.rows[0].r.activities).toBeGreaterThanOrEqual(1);
    expect((await asSuperuser("select 1 from public.activities where id = $1", [expired])).rowCount).toBe(0);
  });

  it("refuse de garder une activité Strava plus de 7 jours, ou sans connexion", async () => {
    const connection = await stravaConnection();
    await expectFailure(
      asSuperuser(
        `insert into public.activities (athlete_id, source, external_id, connection_id, sport, start_time, local_date, expires_at)
         values ($1, 'strava', '1', $2, 'run', now(), current_date, now() + interval '8 days')`,
        [athlete.id, connection],
      ),
      /activities_source_rules/,
    );
    await expectFailure(
      asSuperuser(
        `insert into public.activities (athlete_id, source, external_id, sport, start_time, local_date, expires_at)
         values ($1, 'strava', '2', 'run', now(), current_date, now() + interval '1 day')`,
        [athlete.id],
      ),
      /activities_source_rules/,
    );
  });

  it("un identifiant externe n'existe qu'une fois", async () => {
    const day = freshDay();
    const external = String(Math.floor(Math.random() * 1e12));
    const connection = await stravaConnection();
    const insert = (user: TestUser, conn: string) =>
      asSuperuser(
        `insert into public.activities (athlete_id, source, external_id, connection_id, sport, start_time, local_date, expires_at)
         values ($1, 'strava', $2, $3, 'run', now(), $4, now() + interval '6 days')`,
        [user.id, external, conn, day],
      );
    await insert(athlete, connection);
    await expectFailure(insert(athlete, connection), /duplicate key/);
    const other = await createUser({ name: "Autre athlète Strava" });
    await expectFailure(insert(other, await stravaConnection(other)), /duplicate key/);

    const fitId = randomUUID();
    const fit = () =>
      as(athlete, `insert into public.activities (source, external_id, sport, start_time, local_date) values ('fit_upload', $1, 'run', now(), $2)`, [fitId, day]);
    await fit();
    await expectFailure(fit(), /duplicate key/);
  });

  it("la déconnexion efface jetons, activités et rapprochements Strava", async () => {
    const user = await createUser({ name: "Athlète qui se déconnecte" });
    const connection = await stravaConnection(user);
    await asSuperuser("insert into public.oauth_tokens (connection_id, access_token, refresh_token, expires_at) values ($1, 'v1.a', 'v1.r', now())", [connection]);
    await asSuperuser(
      `insert into public.activities (athlete_id, source, external_id, connection_id, sport, start_time, local_date, expires_at)
       values ($1, 'strava', $2, $3, 'run', now(), current_date, now() + interval '6 days')`,
      [user.id, String(Math.floor(Math.random() * 1e12)), connection],
    );
    await asSuperuser("delete from public.external_connections where id = $1", [connection]);
    const left = await asSuperuser(
      `select (select count(*) from public.oauth_tokens where connection_id = $1)::int as tokens,
              (select count(*) from public.activities where athlete_id = $2)::int as activities`,
      [connection, user.id],
    );
    expect(left.rows[0]).toEqual({ tokens: 0, activities: 0 });
  });
});

describe("lecture Strava", () => {
  it("une relecture met à jour l'activité sans repousser son effacement, ni changer d'athlète", async () => {
    const day = freshDay();
    const session = await insertSession({ date: day, sport: "run", duration: 3000 });
    const connection = await stravaConnection();
    const external = String(Math.floor(Math.random() * 1e12));
    const item = (moving: number) => [
      { external_id: external, sport: "run", sport_detail: "Run", start_time: `${day}T06:00:00Z`, local_date: day, local_start_time: "08:00:00", moving_s: moving, elapsed_s: moving },
    ];
    await asSuperuser("select public.upsert_strava_activities($1, $2::jsonb)", [connection, JSON.stringify(item(3000))]);
    const first = await asSuperuser("select id, expires_at from public.activities where external_id = $1 and source = 'strava'", [external]);
    expect(await matchesOf(first.rows[0].id)).toMatchObject([{ session_id: session, status: "auto" }]);

    await asSuperuser("update public.activities set expires_at = expires_at - interval '2 days' where id = $1", [first.rows[0].id]);
    await asSuperuser("select public.upsert_strava_activities($1, $2::jsonb)", [connection, JSON.stringify(item(1500))]);
    const second = await asSuperuser("select moving_s, expires_at from public.activities where id = $1", [first.rows[0].id]);
    expect(second.rows[0].moving_s).toBe(1500);
    expect(new Date(second.rows[0].expires_at).getTime()).toBeLessThan(new Date(first.rows[0].expires_at).getTime());

    const other = await createUser({ name: "Autre athlète relecture" });
    await asSuperuser("select public.upsert_strava_activities($1, $2::jsonb)", [await stravaConnection(other), JSON.stringify(item(10))]);
    const owner = await asSuperuser("select athlete_id, moving_s from public.activities where external_id = $1 and source = 'strava'", [external]);
    expect(owner.rows).toEqual([{ athlete_id: athlete.id, moving_s: 1500 }]);
    await expectFailure(as(athlete, "select public.upsert_strava_activities($1, '[]'::jsonb)", [connection]), DENIED);
  });
});

describe("connexions et jetons", () => {
  it("les jetons sont inaccessibles par l'API, les connexions visibles de l'athlète seul", async () => {
    const connection = await stravaConnection();
    await asSuperuser(
      "insert into public.oauth_tokens (connection_id, access_token, refresh_token, expires_at) values ($1, 'v1.a', 'v1.r', now()) on conflict do nothing",
      [connection],
    );
    await expectFailure(as(athlete, "select * from public.oauth_tokens"), DENIED);
    await expectFailure(as(null, "select * from public.oauth_tokens"), DENIED);
    await expectFailure(asSuperuser("insert into public.oauth_tokens (connection_id, access_token, refresh_token, expires_at) values ($1, 'clair', 'clair', now())", [randomUUID()]), /check|foreign key/);

    expect((await as(athlete, "select 1 from public.external_connections")).rowCount).toBe(1);
    expect((await as(coach, "select 1 from public.external_connections")).rowCount).toBe(0);
    await expectFailure(as(athlete, "update public.external_connections set status = 'active'"), DENIED);
    const status = await as(coach, "select * from public.athlete_sync_status($1)", [[athlete.id, outsider.id]]);
    expect(status.rows).toMatchObject([{ athlete_id: athlete.id, provider: "strava", status: "active" }]);
    expect((await as(outsider, "select * from public.athlete_sync_status($1)", [[athlete.id]])).rowCount).toBe(0);
  });

  it("l'administrateur compte les comptes reliés, sans voir les connexions elles-mêmes", async () => {
    await stravaConnection();
    await expectFailure(as(coach, "select * from public.admin_connection_counts()"), /forbidden/);
    await asSuperuser("insert into public.admin_users (user_id) values ($1) on conflict do nothing", [outsider.id]);
    try {
      const { rows } = await as(outsider, "select provider, status, connections::int as n from public.admin_connection_counts()");
      expect(rows.find((r) => r.provider === "strava" && r.status === "active")?.n).toBeGreaterThanOrEqual(1);
      expect((await as(outsider, "select 1 from public.external_connections")).rowCount).toBe(0);
    } finally {
      await asSuperuser("delete from public.admin_users where user_id = $1", [outsider.id]);
    }
  });
});

describe("déclarations de l'athlète", () => {
  it("l'athlète déclare, ses coachs lisent", async () => {
    const day = freshDay();
    const session = await insertSession({ date: day });
    await as(athlete, "insert into public.session_completions (session_id, status, rpe, note) values ($1, 'partial', 7, 'Jambes lourdes')", [session]);
    const read = await as(viewer, "select status, rpe from public.session_completions where session_id = $1", [session]);
    expect(read.rows).toEqual([{ status: "partial", rpe: 7 }]);
    await expectFailure(as(coach, "insert into public.session_completions (session_id, status) values ($1, 'done')", [session]), DENIED);
    await expectFailure(as(coach, "update public.session_completions set status = 'done' where session_id = $1 returning 1", [session]).then((r) => {
      if (r.rowCount === 0) throw new Error("permission denied (aucune ligne)");
    }), DENIED);
    expect((await as(outsider, "select 1 from public.session_completions where session_id = $1", [session])).rowCount).toBe(0);

    // Un brouillon du coach n'existe pas encore pour l'athlète.
    const draft = await insertSession({ date: day, state: "draft" });
    await expectFailure(as(athlete, "insert into public.session_completions (session_id, status) values ($1, 'done')", [draft]), DENIED);
  });
});

describe("file de jobs", () => {
  it("un même évènement ne crée qu'un job, réservé par un seul exécutant", async () => {
    const key = `test:${randomUUID()}`;
    await asSuperuser("insert into public.sync_jobs (kind, dedupe_key) values ('maintenance', $1)", [key]);
    const again = await asSuperuser("insert into public.sync_jobs (kind, dedupe_key) values ('maintenance', $1) on conflict (dedupe_key) do nothing returning id", [key]);
    expect(again.rowCount).toBe(0);

    const [first, second] = await Promise.all([
      asSuperuser("select id from public.claim_sync_jobs(50)"),
      asSuperuser("select id from public.claim_sync_jobs(50)"),
    ]);
    const ids = [...first.rows, ...second.rows].map((r) => String(r.id));
    expect(new Set(ids).size).toBe(ids.length);

    // Un job resté bloqué est repris.
    await asSuperuser("update public.sync_jobs set locked_at = now() - interval '11 minutes' where dedupe_key = $1", [key]);
    const reclaimed = await asSuperuser("select id, attempts from public.claim_sync_jobs(50) where dedupe_key = $1", [key]);
    expect(reclaimed.rows[0].attempts).toBe(2);
    await expectFailure(as(athlete, "select * from public.claim_sync_jobs(1)"), DENIED);
    await expectFailure(as(athlete, "select payload from public.sync_jobs"), DENIED);
  });
});

describe("temps réel", () => {
  it("ce qui vient de Strava part sur le canal de l'athlète seul", async () => {
    const day = freshDay();
    const strava = await insertStrava({ date: day });
    const fit = await insertFit({ date: shift(day, 2) });
    const topics = await asSuperuser(
      "select distinct topic from realtime.messages where payload ->> 'table' = 'activities' and inserted_at > now() - interval '1 minute'",
    );
    const list = topics.rows.map((r) => r.topic);
    expect(list).toContain(`self:${athlete.id}`);
    expect(list).toContain(`athlete:${athlete.id}`);
    expect(strava && fit).toBeTruthy();

    const canReceive = async (user: TestUser, topic: string) => {
      const [, result] = await asSteps(user, [
        { sql: "select set_config('realtime.topic', $1, true)", params: [topic] },
        { sql: "select private.can_receive_athlete_topic($1) as ok", params: [topic] },
      ]);
      return result.rows[0].ok;
    };
    expect(await canReceive(athlete, `self:${athlete.id}`)).toBe(true);
    expect(await canReceive(coach, `self:${athlete.id}`)).toBe(false);
    expect(await canReceive(coach, `athlete:${athlete.id}`)).toBe(true);
  });
});
