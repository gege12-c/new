/**
 * Courbes des activités : visibles comme l'activité (l'athlète, les coachs qu'il autorise à voir ses
 * activités), écrites par le serveur pour intervals.icu et par l'athlète pour ses fichiers FIT, une
 * seule fois ; effacées avec l'activité.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asSuperuser, closeDb, createUser, DENIED, expectFailure, linkCoach, type TestUser } from "./helpers";

let athlete: TestUser;
let coach: TestUser;
let blind: TestUser;
let stranger: TestUser;

const SERIES = JSON.stringify({ time: [0, 5, 10], watts: [200, 210, null], heartrate: [140, 145, 150] });
const LAPS = JSON.stringify([{ start_s: 0, duration_s: 10, distance_m: null, avg_power: 205, avg_hr: 145, max_hr: 150, avg_cadence: null, avg_speed_mps: null, kind: "work", label: null }]);

beforeAll(async () => {
  athlete = await createUser({ name: "Athlète courbes" });
  coach = await createUser({ name: "Coach courbes", coach: true });
  blind = await createUser({ name: "Coach sans activités courbes", coach: true });
  stranger = await createUser({ name: "Coach étranger courbes", coach: true });
  await linkCoach(coach, athlete);
  const link = await linkCoach(blind, athlete);
  await as(athlete, "select public.set_coach_permissions($1, true, false)", [link]);
});

afterAll(closeDb);

async function activity(source: "intervals" | "fit_upload") {
  const { rows } = await asSuperuser(
    `insert into public.activities (athlete_id, source, external_id, sport, start_time, local_date, local_start_time, moving_s, elapsed_s)
     values ($1, $2, $3, 'bike', '2027-03-02T06:00:00Z', '2027-03-02', '07:00', 3600, 3600) returning id`,
    [athlete.id, source, source === "intervals" ? `i${Math.floor(Math.random() * 1e9)}` : `${randomUUID().replace(/-/g, "").padEnd(64, "0")}:0`],
  );
  return rows[0].id as string;
}

const insertStreams = (user: TestUser, activityId: string) =>
  as(user, "insert into public.activity_streams (activity_id, sample_s, series, laps, laps_origin, bests) values ($1, 5, $2::jsonb, $3::jsonb, 'device', '{\"5\": 260}'::jsonb)", [
    activityId,
    SERIES,
    LAPS,
  ]);
const visible = async (user: TestUser, activityId: string) =>
  (await as(user, "select sample_s, series->'watts' as watts from public.activity_streams where activity_id = $1", [activityId])).rows;

describe("courbes des activités", () => {
  it("intervals.icu : écrites par le serveur, lues par l'athlète et le coach autorisé, cachées aux autres", async () => {
    const id = await activity("intervals");
    await asSuperuser("insert into public.activity_streams (activity_id, sample_s, series, laps, laps_origin) values ($1, 5, $2::jsonb, $3::jsonb, 'detected')", [id, SERIES, LAPS]);
    expect(await visible(athlete, id)).toEqual([{ sample_s: 5, watts: [200, 210, null] }]);
    expect(await visible(coach, id)).toHaveLength(1);
    expect(await visible(blind, id)).toEqual([]);
    expect(await visible(stranger, id)).toEqual([]);
    await expectFailure(as(null, "select count(*) from public.activity_streams"), DENIED);
    // Activité d'intervals.icu : l'athlète n'écrit pas ses courbes, le serveur seul.
    const other = await activity("intervals");
    await expectFailure(insertStreams(athlete, other), DENIED);
  });

  it("fichier FIT : l'athlète enregistre les courbes de son import, une fois ; ni le coach ni un autre", async () => {
    const id = await activity("fit_upload");
    await expectFailure(insertStreams(coach, id), DENIED);
    await expectFailure(insertStreams(stranger, id), DENIED);
    await insertStreams(athlete, id);
    await expectFailure(insertStreams(athlete, id), /duplicate key|activity_streams_pkey/);
    expect(await visible(coach, id)).toHaveLength(1);
    // Ni modification ni effacement à la main : elles suivent l'activité.
    await expectFailure(as(athlete, "update public.activity_streams set sample_s = 6 where activity_id = $1", [id]), DENIED);
    await as(athlete, "delete from public.activity_streams where activity_id = $1", [id]).catch(() => undefined);
    expect(await visible(athlete, id)).toHaveLength(1);
    await as(athlete, "delete from public.activities where id = $1", [id]);
    expect((await asSuperuser("select count(*)::int as n from public.activity_streams where activity_id = $1", [id])).rows[0].n).toBe(0);
  });

  it("contenu contrôlé : séries en objet, intervalles en liste, pas de 1 s à 1 h", async () => {
    const id = await activity("intervals");
    await expectFailure(asSuperuser("insert into public.activity_streams (activity_id, sample_s, series) values ($1, 5, '[]'::jsonb)", [id]), /activity_streams_series_check/);
    await expectFailure(asSuperuser("insert into public.activity_streams (activity_id, sample_s, series, laps) values ($1, 5, '{}'::jsonb, '{}'::jsonb)", [id]), /activity_streams_laps_check/);
    await expectFailure(asSuperuser("insert into public.activity_streams (activity_id, sample_s, series) values ($1, 0, '{}'::jsonb)", [id]), /activity_streams_sample_s_check/);
  });
});
