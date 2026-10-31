/**
 * Seuils TriCoach et intervals.icu, contre une vraie pile Supabase et un faux intervals.icu : la
 * comparaison ne change rien chez intervals.icu ; l'alignement n'envoie que les écarts, en unités
 * SI, recalcule les zones de FC quand une FC change, et ne perd rien même si intervals.icu
 * remplaçait tout le réglage ; clé refusée → reconnexion demandée. Données entièrement fictives.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntervalsApi } from "@/lib/intervals/api";
import { alignIntervalsThresholds, compareIntervalsThresholds, connectIntervals, type IntervalsDeps } from "@/lib/intervals/service";
import type { Database } from "@/lib/supabase/database.types";
import { FakeIntervals } from "../fixtures/fake-intervals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("seuils TriCoach et intervals.icu", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeIntervals();
  const deps: IntervalsDeps = { admin, api: new IntervalsApi("https://fake.intervals.test", fake.fetch), key: randomBytes(32), now: () => new Date() };
  const athlete = `i${Math.floor(Math.random() * 1e6)}`;
  const key = `key${randomUUID().replace(/-/g, "")}`;
  let athleteId = "";

  const setting = (id: number) => fake.settingsOf(athlete).find((s) => s.id === id)!;
  const writes = () => fake.calls.filter((c) => c.startsWith("PUT /api/v1/athlete/0/sport-settings"));

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `seuils-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète seuils", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    await admin.from("athlete_thresholds").insert([
      { athlete_id: athleteId, sport: "bike", metric: "ftp_w", value: 230, effective_from: "2026-01-01" },
      { athlete_id: athleteId, sport: "run", metric: "threshold_pace_s_per_km", value: 300, effective_from: "2026-01-01" },
      { athlete_id: athleteId, sport: "run", metric: "lthr_bpm", value: 180, effective_from: "2026-01-01" },
      { athlete_id: athleteId, sport: "general", metric: "max_hr_bpm", value: 195, effective_from: "2026-01-01" },
    ]);
    fake.addKey(key, athlete);
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("pas encore relié : rien à comparer", async () => {
    expect(await compareIntervalsThresholds(deps, athleteId)).toEqual({ status: "not_linked" });
  });

  it("compare sans rien changer chez intervals.icu", async () => {
    expect(await connectIntervals(deps, athleteId, key)).toEqual({ status: "connected" });
    const result = await compareIntervalsThresholds(deps, athleteId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r]));
    expect(byId["Ride.ftp"]).toMatchObject({ tricoach: 230, intervals: 230, same: true });
    expect(byId["Run.threshold_pace"]).toMatchObject({ tricoach: 300, intervals: 315, same: false });
    expect(byId["Run.lthr"]).toMatchObject({ tricoach: 180, intervals: 176, same: false });
    expect(byId["Swim.threshold_pace"]).toMatchObject({ tricoach: null, intervals: 100 });
    expect(writes()).toEqual([]);
  });

  it("aligne intervals.icu sur TriCoach : seuls les écarts partent, zones de FC recalculées", async () => {
    const result = await alignIntervalsThresholds(deps, athleteId);
    expect(result).toMatchObject({ status: "ok", aligned: 2, failed: 0 });
    expect(writes()).toEqual(["PUT /api/v1/athlete/0/sport-settings/102?recalcHrZones=true"]);
    expect(setting(102)).toMatchObject({ lthr: 180, types: ["Run", "VirtualRun", "TrailRun"], pace_units: "MINS_KM" });
    expect(setting(102).threshold_pace).toBeCloseTo(1000 / 300, 6);
    // Rien de TriCoach pour la natation : la CSS d'intervals.icu reste telle quelle.
    expect(setting(103).threshold_pace).toBe(1);
    if (result.status === "ok") expect(result.rows.filter((r) => r.tricoach !== null).every((r) => r.same)).toBe(true);
    // Déjà alignés : rien n'est renvoyé.
    expect(await alignIntervalsThresholds(deps, athleteId)).toMatchObject({ status: "ok", aligned: 0, failed: 0 });
    expect(writes()).toHaveLength(1);
  });

  it("intervals.icu qui remplacerait tout le réglage : le réglage complet est rétabli, avec la nouvelle valeur", async () => {
    await admin.from("athlete_thresholds").insert({ athlete_id: athleteId, sport: "bike", metric: "ftp_w", value: 245, effective_from: "2026-02-01" });
    fake.replaceWholeSettings = true;
    const result = await alignIntervalsThresholds(deps, athleteId);
    fake.replaceWholeSettings = false;
    expect(result).toMatchObject({ status: "ok", aligned: 1, failed: 0 });
    expect(setting(101)).toMatchObject({ ftp: 245, lthr: 176, max_hr: 195, types: ["Ride", "VirtualRide"], power_zones: [55, 75, 90, 105, 120, 150, 999] });
  });

  it("clé refusée : reconnexion demandée, rien n'est modifié", async () => {
    fake.keys.delete(key);
    expect(await compareIntervalsThresholds(deps, athleteId)).toEqual({ status: "reauth" });
    const { data } = await admin.from("external_connections").select("status").eq("athlete_id", athleteId).eq("provider", "intervals").single();
    expect(data?.status).toBe("reauth_required");
    expect(await alignIntervalsThresholds(deps, athleteId)).toEqual({ status: "reauth" });
  });
});
