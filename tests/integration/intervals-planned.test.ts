/**
 * Séances prévues par le coach dans le calendrier intervals.icu, reprises dans TriCoach, de bout en
 * bout contre une vraie pile Supabase et un faux intervals.icu : reprise avec leur déroulé, sans
 * doublon des séances que TriCoach dépose lui-même, jamais renvoyées vers intervals.icu, rapprochées
 * de l'activité faite, suivies quand le coach les modifie ou les retire, rien de réécrit quand rien ne
 * change. Données entièrement fictives.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntervalsApi } from "@/lib/intervals/api";
import { connectIntervals, disconnectIntervals, runIntervalsJobs, type IntervalsDeps } from "@/lib/intervals/service";
import { addDays } from "@/lib/planning/dates";
import type { Database } from "@/lib/supabase/database.types";
import { localDate } from "@/lib/utils";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";
import { FakeIntervals } from "../fixtures/fake-intervals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("séances prévues dans intervals.icu, reprises dans TriCoach", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeIntervals();
  const deps: IntervalsDeps = { admin, api: new IntervalsApi("https://fake.intervals.test", fake.fetch), key: randomBytes(32), now: () => new Date() };
  const athlete = `p${Math.floor(Math.random() * 1e6)}`;
  const key = `key${randomUUID().replace(/-/g, "")}`;
  const today = localDate("Europe/Paris");
  let athleteId = "";

  const run = () => runIntervalsJobs(deps, { limit: 20, budgetMs: 30_000 });
  const nudge = () => admin.from("sync_jobs").insert({ kind: "intervals_sync", athlete_id: athleteId });
  const sessions = async () =>
    (
      await admin
        .from("planned_sessions")
        .select("id, title, source, external_id, scheduled_date, sport, content, planned_duration_s, version, updated_at, import_notes")
        .eq("athlete_id", athleteId)
        .order("scheduled_date")
    ).data ?? [];
  const coachRide = (extra: Record<string, unknown> = {}) => ({
    id: 5001,
    category: "WORKOUT",
    start_date_local: `${addDays(today, 2)}T00:00:00`,
    type: "Ride",
    name: "3x10 seuil",
    description: "- 10m 50-75%\n3x\n- 10m 90-95%\n- 5m 55%\n- 10m 50%",
    moving_time: 4200,
    updated: "2026-10-31T10:00:00Z",
    workout_doc: {
      steps: [
        { duration: 600, warmup: true, power: { start: 50, end: 75, units: "%ftp" } },
        {
          reps: 3,
          steps: [
            { duration: 600, power: { start: 90, end: 95, units: "%ftp" } },
            { duration: 300, power: { value: 55, units: "%ftp" } },
          ],
        },
        { duration: 600, cooldown: true, power: { value: 50, units: "%ftp" } },
      ],
    },
    ...extra,
  });

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `intervals-planned-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète calendrier coach", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    await admin.from("athlete_thresholds").insert({ athlete_id: athleteId, sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" });
    // Une séance planifiée dans TriCoach : déposée chez intervals.icu, jamais reprise en double.
    const parsed = parseWorkout(bikeThreshold);
    if (!parsed.success) throw new Error("fixture");
    await admin
      .from("planned_sessions")
      .insert({ athlete_id: athleteId, scheduled_date: addDays(today, 3), sport: "bike", title: "Séance de TriCoach", content: parsed.data, state: "published" });
    fake.addKey(key, athlete);
    fake.addPlanned(athlete, coachRide());
    fake.addPlanned(athlete, {
      id: 5002,
      category: "WORKOUT",
      start_date_local: `${addDays(today, -1)}T00:00:00`,
      type: "Run",
      name: "Footing",
      description: "- 30m Z2 HR",
      moving_time: 1800,
    });
    // Une note du coach : pas une séance.
    fake.addPlanned(athlete, { id: 5003, category: "NOTE", start_date_local: `${today}T00:00:00`, name: "Repos actif" });
    // Faite hier avec la montre : à rapprocher du footing prévu par le coach.
    fake.addActivity(athlete, { id: "a900", start_date_local: `${addDays(today, -1)}T18:00:00`, type: "Run", name: "Footing", source: "SUUNTO", file_type: "fit", moving_time: 1790, elapsed_time: 1810 });
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("reprend les séances du coach avec leur déroulé, sans doublon ni renvoi vers intervals.icu", async () => {
    expect(await connectIntervals(deps, athleteId, key)).toEqual({ status: "connected" });
    await run();
    const rows = await sessions();
    expect(rows.map((r) => [r.title, r.source, r.external_id])).toEqual([
      ["Footing", "intervals", "5002"],
      ["3x10 seuil", "intervals", "5001"],
      ["Séance de TriCoach", "tricoach", null],
    ]);
    const ride = rows.find((r) => r.external_id === "5001")!;
    expect(ride).toMatchObject({ scheduled_date: addDays(today, 2), sport: "bike", planned_duration_s: 3900 });
    const steps = (ride.content as { segments: { steps: { kind: string; count?: number }[] }[] }).segments[0].steps;
    expect(steps.map((s) => s.kind)).toEqual(["step", "repeat", "step"]);
    expect(steps[1].count).toBe(3);
    // Seule la séance de TriCoach part chez intervals.icu.
    expect(fake.eventsOf(athlete).map((e) => e.name)).toEqual(["Séance de TriCoach"]);
    // Le footing prévu par le coach est rattaché à l'activité faite hier.
    const footing = rows.find((r) => r.external_id === "5002")!;
    const { data: activity } = await admin.from("activities").select("id").eq("athlete_id", athleteId).eq("external_id", "a900").single();
    const { data: match } = await admin.from("session_activity_matches").select("session_id, status").eq("activity_id", activity!.id).single();
    expect(match).toEqual({ session_id: footing.id, status: "auto" });
  });

  it("rien n'est réécrit quand rien ne change ; une séance modifiée suit, une séance retirée disparaît", async () => {
    const before = await sessions();
    await nudge();
    await run();
    expect((await sessions()).map((r) => r.updated_at)).toEqual(before.map((r) => r.updated_at));
    // La séance de TriCoach, déposée à la passe d'avant, n'est jamais reprise comme séance du coach.
    expect((await sessions()).filter((r) => r.source === "intervals")).toHaveLength(2);

    fake.addPlanned(athlete, coachRide({ name: "4x10 seuil", updated: "2026-10-31T16:00:00Z", start_date_local: `${addDays(today, 4)}T07:30:00` }));
    fake.removePlanned(athlete, 5002);
    await nudge();
    await run();
    const after = await sessions();
    const ride = after.find((r) => r.external_id === "5001")!;
    expect(ride).toMatchObject({ title: "4x10 seuil", scheduled_date: addDays(today, 4) });
    expect(ride.version).toBe(before.find((r) => r.external_id === "5001")!.version + 1);
    expect(after.find((r) => r.external_id === "5002")).toBeUndefined();
    const { data: logs } = await admin.from("sync_logs").select("message").eq("athlete_id", athleteId).eq("event", "intervals_planned").order("created_at");
    expect(logs!.map((l) => l.message)).toEqual(["2 séance(s) prévue(s) reprise(s), 0 retirée(s)", "1 séance(s) prévue(s) reprise(s), 1 retirée(s)"]);
  });

  it("délier intervals.icu : les séances reprises à venir partent, les passées restent", async () => {
    fake.addPlanned(athlete, { id: 5004, category: "WORKOUT", start_date_local: `${addDays(today, -3)}T00:00:00`, type: "Swim", name: "Technique", moving_time: 2400 });
    await nudge();
    await run();
    expect((await sessions()).filter((r) => r.source === "intervals").map((r) => r.external_id)).toEqual(["5004", "5001"]);
    expect(await disconnectIntervals(deps, athleteId)).toEqual({ removed: true });
    const left = await sessions();
    expect(left.map((r) => [r.title, r.source])).toEqual([
      ["Technique", "intervals"],
      ["Séance de TriCoach", "tricoach"],
    ]);
  });
});
