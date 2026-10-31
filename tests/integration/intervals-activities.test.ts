/**
 * Retour des activités par intervals.icu, de bout en bout, contre une vraie pile Supabase (base, API,
 * triggers de rapprochement et de doublons) et un faux intervals.icu : historique de 90 jours à la
 * première réception, rattachement à la séance, aucune réécriture d'une activité inchangée,
 * modification et retrait répercutés, activités reçues de Strava ignorées (comptées), même séance
 * déjà arrivée par Strava gardée en doublon. Lancement : pile locale démarrée, variables de .env.local-stack.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntervalsApi } from "@/lib/intervals/api";
import { connectIntervals, runIntervalsJobs, type IntervalsDeps } from "@/lib/intervals/service";
import { addDays } from "@/lib/planning/dates";
import type { Database } from "@/lib/supabase/database.types";
import { localDate } from "@/lib/utils";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";
import { FakeIntervals } from "../fixtures/fake-intervals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("activités faites, reçues d'intervals.icu", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeIntervals();
  const deps: IntervalsDeps = { admin, api: new IntervalsApi("https://fake.intervals.test", fake.fetch), key: randomBytes(32), now: () => new Date() };
  const athlete = `a${Math.floor(Math.random() * 1e6)}`;
  const key = `key${randomUUID().replace(/-/g, "")}`;
  const today = localDate("Europe/Paris");
  let athleteId = "";
  let sessionId = "";

  const run = () => runIntervalsJobs(deps, { limit: 20, budgetMs: 30_000 });
  const nudge = () => admin.from("sync_jobs").insert({ kind: "intervals_sync", athlete_id: athleteId });
  const received = async () =>
    (await admin.from("activities").select("id, external_id, name, avg_power, duplicate_of, updated_at").eq("athlete_id", athleteId).eq("source", "intervals").order("start_time")).data ?? [];
  const ride = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
    id,
    start_date_local: `${day}T07:02:00`,
    start_date: `${day}T06:02:00Z`,
    type: "Ride",
    name: "Seuil",
    source: "SUUNTO",
    file_type: "fit",
    moving_time: 3500,
    elapsed_time: 3580,
    distance: 30_000,
    average_heartrate: 150,
    icu_average_watts: 215,
    ...extra,
  });

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `intervals-act-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète retour intervals", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    const parsed = parseWorkout(bikeThreshold);
    if (!parsed.success) throw new Error("fixture");
    const session = await admin
      .from("planned_sessions")
      .insert({ athlete_id: athleteId, scheduled_date: addDays(today, -1), start_time: "07:00", sport: "bike", title: "Seuil hier", content: parsed.data, state: "published" })
      .select("id")
      .single();
    if (session.error) throw session.error;
    sessionId = session.data.id;
    fake.addKey(key, athlete);
    fake.addActivity(athlete, ride("i100", addDays(today, -1)));
    fake.addActivity(athlete, ride("i101", addDays(today, -60), { type: "Run", name: "Footing", icu_average_watts: null }));
    // Hors de l'historique relu à la première réception.
    fake.addActivity(athlete, ride("i102", addDays(today, -120)));
    // Reçue de Strava par intervals.icu : non transmise.
    fake.addActivity(athlete, { id: "i103", start_date_local: `${addDays(today, -2)}T18:00:00`, type: "Run", source: "STRAVA" });
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("première réception : 90 jours, rattachement à la séance prévue, activités de Strava comptées à part", async () => {
    expect(await connectIntervals(deps, athleteId, key)).toEqual({ status: "connected" });
    await run();
    expect((await received()).map((a) => a.external_id)).toEqual(["i101", "i100"]);
    const yesterday = (await received()).find((a) => a.external_id === "i100")!;
    const { data: match } = await admin.from("session_activity_matches").select("session_id, status").eq("activity_id", yesterday.id).single();
    expect(match).toEqual({ session_id: sessionId, status: "auto" });
    const { data: connection } = await admin.from("external_connections").select("activities_synced_at, activities_skipped").eq("athlete_id", athleteId).eq("provider", "intervals").single();
    expect(connection!.activities_synced_at).not.toBeNull();
    expect(connection!.activities_skipped).toBe(1);
  });

  it("rien n'est réécrit quand rien n'a changé ; une modification et un retrait chez intervals.icu sont répercutés", async () => {
    const before = await received();
    await nudge();
    await run();
    expect((await received()).map((a) => a.updated_at)).toEqual(before.map((a) => a.updated_at));

    fake.removeActivity(athlete, "i100");
    fake.addActivity(athlete, ride("i100", addDays(today, -1), { name: "Seuil, renommée", icu_average_watts: 220 }));
    await nudge();
    await run();
    expect((await received()).find((a) => a.external_id === "i100")).toMatchObject({ name: "Seuil, renommée", avg_power: 220 });

    // Retirée chez intervals.icu : retirée ici, dans la période relue (14 jours) ; plus ancienne : gardée.
    fake.removeActivity(athlete, "i100");
    fake.removeActivity(athlete, "i101");
    await nudge();
    await run();
    expect((await received()).map((a) => a.external_id)).toEqual(["i101"]);
  });

  it("mesures du matin : complètent la forme du jour, sans jamais remplacer une saisie de l'athlète", async () => {
    const yesterday = addDays(today, -1);
    await admin.from("wellness_entries").insert({ athlete_id: athleteId, entry_date: yesterday, fatigue: 2, resting_hr: 51 });
    fake.wellness.set(athlete, [
      { id: yesterday, restingHR: 47, hrv: 63, sleepSecs: 27_000 },
      { id: today, restingHR: 46, weight: 72.4 },
    ]);
    await nudge();
    await run();
    const { data } = await admin.from("wellness_entries").select("entry_date, fatigue, resting_hr, hrv_ms, sleep_hours, weight_kg").eq("athlete_id", athleteId).order("entry_date");
    expect(data).toEqual([
      { entry_date: yesterday, fatigue: 2, resting_hr: 51, hrv_ms: 63, sleep_hours: 7.5, weight_kg: null },
      { entry_date: today, fatigue: null, resting_hr: 46, hrv_ms: null, sleep_hours: null, weight_kg: 72.4 },
    ]);
  });

  it("même séance faite déjà arrivée par Strava : l'activité de la montre devient l'original, Strava le doublon", async () => {
    const day = addDays(today, -3);
    const { data: strava } = await admin
      .from("external_connections")
      .insert({ athlete_id: athleteId, provider: "strava", external_athlete_id: String(Math.floor(Math.random() * 1e9)), scopes: ["read", "activity:read_all"] })
      .select("id")
      .single();
    const { data: stravaActivity, error } = await admin
      .from("activities")
      .insert({
        athlete_id: athleteId,
        source: "strava",
        external_id: String(Math.floor(Math.random() * 1e12)),
        connection_id: strava!.id,
        sport: "bike",
        start_time: `${day}T06:01:00Z`,
        local_date: day,
        local_start_time: "07:01:00",
        moving_s: 3510,
        elapsed_s: 3590,
        expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    fake.addActivity(athlete, ride("i200", day));
    await nudge();
    await run();
    const watch = (await received()).find((a) => a.external_id === "i200")!;
    const { data: copy } = await admin.from("activities").select("duplicate_of").eq("id", stravaActivity!.id).single();
    expect(copy!.duplicate_of).toBe(watch.id);
    expect(watch.duplicate_of).toBeNull();
  });
});
