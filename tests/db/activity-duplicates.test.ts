/**
 * Une même séance faite, arrivée par plusieurs sources (Strava, intervals.icu, fichier FIT) : un seul
 * original, rapproché et compté ; les autres sont des doublons, sans rapprochement. Les décisions de
 * l'athlète prises sur un doublon passent à l'original. Activités d'intervals.icu : écrites par le
 * serveur seul, lisibles comme les fichiers importés.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, linkCoach, workoutJson, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let blind: TestUser;
let connection: string;

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète doublons" });
  coach = await createUser({ name: "Coach doublons", coach: true });
  blind = await createUser({ name: "Coach sans activités doublons", coach: true });
  await linkCoach(coach, athlete);
  const link = await linkCoach(blind, athlete);
  await as(athlete, "select public.set_coach_permissions($1, true, false)", [link]);
  const { rows } = await asSuperuser(
    "insert into public.external_connections (athlete_id, provider, external_athlete_id, scopes) values ($1, 'strava', $2, '{read,activity:read_all}') returning id",
    [athlete.id, String(Math.floor(Math.random() * 1e9))],
  );
  connection = rows[0].id;
});

afterAll(closeDb);

let dayCounter = 0;
function freshDay() {
  dayCounter += 4;
  return new Date(Date.UTC(2027, 5, 1) + dayCounter * 86_400_000).toISOString().slice(0, 10);
}

async function session(date: string) {
  const { rows } = await as(
    coach,
    `insert into public.planned_sessions (athlete_id, scheduled_date, start_time, sport, title, content, state, planned_duration_s)
     values ($1, $2, '07:00', 'bike', 'Seuil', $3::jsonb, 'published', 3600) returning id`,
    [athlete.id, date, workoutJson()],
  );
  return rows[0].id as string;
}

/** Départ à 07:00 heure de Paris (05:00 UTC en été), décalé de `shiftS` secondes. */
async function activity(source: "strava" | "intervals" | "fit_upload", date: string, options: { shiftS?: number; seconds?: number; sport?: string } = {}) {
  const shift = options.shiftS ?? 0;
  const local = new Date(Date.parse(`${date}T07:00:00Z`) + shift * 1000).toISOString().slice(11, 19);
  const { rows } = await asSuperuser(
    `insert into public.activities
       (athlete_id, source, external_id, connection_id, sport, start_time, local_date, local_start_time, moving_s, elapsed_s, expires_at)
     values ($1, $2, $3, $4, $5, ($6 || 'T05:00:00Z')::timestamptz + make_interval(secs => $7), $6::date, $8::time, $9, $9,
             case when $2 = 'strava' then now() + interval '6 days' end)
     returning id`,
    [
      athlete.id,
      source,
      source === "fit_upload" ? `${randomUUID().replace(/-/g, "").padEnd(64, "0")}:0` : source === "intervals" ? `i${Math.floor(Math.random() * 1e9)}` : String(Math.floor(Math.random() * 1e12)),
      source === "strava" ? connection : null,
      options.sport ?? "bike",
      date,
      shift,
      local,
      options.seconds ?? 3540,
    ],
  );
  return rows[0].id as string;
}

const duplicateOf = async (id: string) => (await asSuperuser("select duplicate_of from public.activities where id = $1", [id])).rows[0]?.duplicate_of ?? null;
const matches = async (id: string) =>
  (await asSuperuser("select session_id, status from public.session_activity_matches where activity_id = $1 order by status", [id])).rows as { session_id: string; status: string }[];

describe("une même séance faite, plusieurs sources", () => {
  it("Strava d'abord, puis intervals.icu : l'activité d'intervals.icu devient l'original et reprend le rattachement", async () => {
    const day = freshDay();
    const planned = await session(day);
    const strava = await activity("strava", day);
    expect(await matches(strava)).toEqual([{ session_id: planned, status: "auto" }]);

    const watch = await activity("intervals", day, { shiftS: 20, seconds: 3560 });
    expect(await duplicateOf(strava)).toBe(watch);
    expect(await duplicateOf(watch)).toBeNull();
    expect(await matches(strava)).toEqual([]);
    expect(await matches(watch)).toEqual([{ session_id: planned, status: "auto" }]);
  });

  it("une décision de l'athlète sur l'activité Strava passe à l'original", async () => {
    const day = freshDay();
    const morning = await session(day);
    const strava = await activity("strava", day);
    // L'athlète la rattache lui-même (décision « confirmed »).
    await as(athlete, "select public.associate_activity($1, $2)", [morning, strava]);
    expect(await matches(strava)).toEqual([{ session_id: morning, status: "confirmed" }]);

    const watch = await activity("intervals", day, { shiftS: -40 });
    expect(await matches(watch)).toEqual([{ session_id: morning, status: "confirmed" }]);
    expect(await matches(strava)).toEqual([]);
  });

  it("une activité Strava arrivée après l'original est aussitôt un doublon, sans rattachement", async () => {
    const day = freshDay();
    const planned = await session(day);
    const file = await activity("fit_upload", day);
    const strava = await activity("strava", day, { shiftS: 60 });
    expect(await duplicateOf(strava)).toBe(file);
    expect(await matches(strava)).toEqual([]);
    // Sans le doublon, deux activités presque identiques rendraient le rattachement ambigu.
    expect(await matches(file)).toEqual([{ session_id: planned, status: "auto" }]);
  });

  it("fichier FIT et intervals.icu : le premier arrivé reste l'original", async () => {
    const day = freshDay();
    const file = await activity("fit_upload", day);
    const watch = await activity("intervals", day, { shiftS: 5 });
    expect(await duplicateOf(watch)).toBe(file);
    expect(await duplicateOf(file)).toBeNull();
  });

  it("deux séances différentes ne sont jamais des doublons", async () => {
    const day = freshDay();
    const first = await activity("strava", day);
    const later = await activity("intervals", day, { shiftS: 2 * 3600 });
    const run = await activity("intervals", freshDay());
    const otherSport = await activity("intervals", day, { shiftS: 30, sport: "run" });
    const shorter = await activity("fit_upload", day, { shiftS: 10, seconds: 1200 });
    for (const id of [first, later, run, otherSport, shorter]) expect(await duplicateOf(id)).toBeNull();
    // Même source : deux activités Strava distinctes, même proches, restent distinctes.
    const twin = await activity("strava", day, { shiftS: 15 });
    expect(await duplicateOf(twin)).toBeNull();
  });

  it("l'original effacé, son doublon prend sa place et son rattachement", async () => {
    const day = freshDay();
    const planned = await session(day);
    const file = await activity("fit_upload", day);
    const strava = await activity("strava", day, { shiftS: 30 });
    expect(await duplicateOf(strava)).toBe(file);
    await as(athlete, "delete from public.activities where id = $1", [file]);
    expect(await duplicateOf(strava)).toBeNull();
    expect(await matches(strava)).toEqual([{ session_id: planned, status: "auto" }]);
  });
});

describe("activités d'intervals.icu", () => {
  it("lisibles de l'athlète et des coachs qu'il autorise à voir ses activités, comme un fichier importé", async () => {
    const watch = await activity("intervals", freshDay());
    const sees = async (user: TestUser) => (await as(user, "select 1 from public.activities where id = $1", [watch])).rowCount;
    expect(await sees(athlete)).toBe(1);
    expect(await sees(coach)).toBe(1);
    expect(await sees(blind)).toBe(0);
  });

  it("écrites par le serveur seul : ni ajout ni suppression par l'API", async () => {
    const day = freshDay();
    await expectFailure(
      as(
        athlete,
        `insert into public.activities (source, external_id, sport, start_time, local_date) values ('intervals', 'i42', 'bike', ($1 || 'T05:00:00Z')::timestamptz, $1::date)`,
        [day],
      ),
      DENIED,
    );
    const watch = await activity("intervals", day);
    const removed = await as(athlete, "delete from public.activities where id = $1", [watch]);
    expect(removed.rowCount).toBe(0);
  });

  it("source et règles de conservation contrôlées", async () => {
    const day = freshDay();
    await expectFailure(
      asSuperuser(
        `insert into public.activities (athlete_id, source, external_id, sport, start_time, local_date, expires_at)
         values ($1, 'intervals', 'i43', 'bike', ($2 || 'T05:00:00Z')::timestamptz, $2::date, now() + interval '1 day')`,
        [athlete.id, day],
      ),
      /activities_source_rules/,
    );
    await expectFailure(
      asSuperuser(
        `insert into public.activities (athlete_id, source, external_id, sport, start_time, local_date) values ($1, 'garmin', 'g1', 'bike', now(), current_date)`,
        [athlete.id],
      ),
      /activities_source_check/,
    );
  });
});

describe("version du schéma", () => {
  it("lisible sans compte, sans rien révéler d'autre (null hors de Supabase)", async () => {
    const { rows } = await as(null, "select public.schema_version() as v");
    expect(rows[0].v === null || /^\d{14}$/.test(rows[0].v)).toBe(true);
  });
});
