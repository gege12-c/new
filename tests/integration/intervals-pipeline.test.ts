/**
 * Relais intervals.icu, de bout en bout, contre une vraie pile Supabase (base, API, triggers) et un
 * faux intervals.icu : clé vérifiée puis chiffrée, dépôt des seules séances publiées des 14 prochains
 * jours, mise à jour sans doublon, retrait, séance impossible à transmettre, séance refusée isolée,
 * quota, clé retirée, déconnexion. Lancement : pile locale démarrée, variables de .env.local-stack chargées.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntervalsApi } from "@/lib/intervals/api";
import { connectIntervals, disconnectIntervals, resendIntervals, runIntervalsJobs, type IntervalsDeps } from "@/lib/intervals/service";
import { addDays } from "@/lib/planning/dates";
import type { Database } from "@/lib/supabase/database.types";
import { localDate } from "@/lib/utils";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout, type WorkoutInput } from "@/lib/workout/schema";
import { FakeIntervals } from "../fixtures/fake-intervals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

const openStep: WorkoutInput = {
  schemaVersion: 1,
  segments: [{ id: "s", sport: "run", steps: [{ kind: "step", id: "o", type: "drill", length: { unit: "open" } }] }],
};

describe.skipIf(!url || !serviceKey)("relais intervals.icu (séance → calendrier intervals.icu → montres)", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeIntervals();
  const deps: IntervalsDeps = { admin, api: new IntervalsApi("https://fake.intervals.test", fake.fetch), key: randomBytes(32), now: () => new Date() };
  const athlete = `i${Math.floor(Math.random() * 1e6)}`;
  const key = `key${randomUUID().replace(/-/g, "")}`;
  const today = localDate("Europe/Paris");
  let athleteId = "";

  const run = () => runIntervalsJobs(deps, { limit: 20, budgetMs: 30_000 });
  const events = () => fake.eventsOf(athlete);
  const rows = async () =>
    (await admin.from("device_workouts").select("external_id, status, remote_id, last_error").eq("athlete_id", athleteId).eq("provider", "intervals")).data ?? [];
  const connection = async () =>
    (await admin.from("external_connections").select("id, status, last_error, external_athlete_id").eq("athlete_id", athleteId).eq("provider", "intervals").maybeSingle()).data;
  const nudge = () => admin.from("sync_jobs").insert({ kind: "intervals_sync", athlete_id: athleteId });

  async function session(date: string, state: "draft" | "published", content: WorkoutInput = bikeThreshold, title = "Seuil 4 × 8 min") {
    const parsed = parseWorkout(content);
    if (!parsed.success) throw new Error("fixture");
    const { data, error } = await admin
      .from("planned_sessions")
      .insert({ athlete_id: athleteId, scheduled_date: date, sport: parsed.data.segments[0].sport, title, content: parsed.data, state })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `intervals-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète intervals", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    await admin.from("athlete_thresholds").insert({ athlete_id: athleteId, sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" });
    fake.addKey(key, athlete);
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  let sessionA = "";
  let sessionB = "";

  it("clé refusée : rien n'est enregistré ; clé valable : vérifiée, chiffrée, compte reconnu", async () => {
    expect(await connectIntervals(deps, athleteId, "mauvaise-cle")).toEqual({ status: "invalid_key" });
    expect(await connection()).toBeNull();
    expect(await connectIntervals(deps, athleteId, `  ${key}  `)).toEqual({ status: "connected" });
    const linked = await connection();
    expect(linked).toMatchObject({ status: "active", external_athlete_id: athlete });
    const { data: stored } = await admin.from("oauth_tokens").select("access_token").eq("connection_id", linked!.id).single();
    expect(stored!.access_token).toMatch(/^v1\./);
    expect(stored!.access_token).not.toContain(key);
  });

  it("dépôt des seules séances publiées des 14 prochains jours, en watts calculés par TriCoach", async () => {
    sessionA = await session(addDays(today, 1), "published");
    sessionB = await session(addDays(today, 10), "published", bikeThreshold, "Longue");
    await session(addDays(today, 20), "published", bikeThreshold, "Trop loin");
    await session(addDays(today, -1), "published", bikeThreshold, "Passée");
    await session(addDays(today, 2), "draft", bikeThreshold, "Brouillon");
    await run();
    expect(events().map((e) => e.name).sort()).toEqual(["Longue", "Seuil 4 × 8 min"]);
    const a = events().find((e) => e.external_id === `tricoach-${sessionA}-0`)!;
    expect(a).toMatchObject({ category: "WORKOUT", type: "Ride", start_date_local: `${addDays(today, 1)}T00:00:00` });
    expect(a.description).toContain("- Travail 8m 238-250w 85-95rpm");
    expect((await rows()).map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("séance modifiée : mise à jour du même évènement ; séances inchangées : rien n'est renvoyé", async () => {
    const before = events().find((e) => e.external_id === `tricoach-${sessionA}-0`)!.id;
    const posts = fake.calls.filter((c) => c.startsWith("POST")).length;
    await admin.from("planned_sessions").update({ title: "Seuil, version 2" }).eq("id", sessionA);
    await run();
    const updated = events().filter((e) => e.external_id === `tricoach-${sessionA}-0`);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: before, name: "Seuil, version 2" });
    expect(fake.calls.filter((c) => c.startsWith("POST")).length).toBe(posts + 1);
    await nudge();
    await run();
    expect(fake.calls.filter((c) => c.startsWith("POST")).length).toBe(posts + 1);
  });

  it("séance annulée ou déplacée hors de la fenêtre : retirée du calendrier intervals.icu", async () => {
    await admin.from("planned_sessions").update({ state: "cancelled" }).eq("id", sessionA);
    await admin.from("planned_sessions").update({ scheduled_date: addDays(today, 30) }).eq("id", sessionB);
    await run();
    expect(events()).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("séance impossible à transmettre (durée libre) : raison gardée, rien de déposé", async () => {
    const id = await session(addDays(today, 3), "published", openStep, "Éducatifs");
    await run();
    expect(events().some((e) => e.external_id === `tricoach-${id}-0`)).toBe(false);
    expect((await rows()).find((r) => r.external_id === `tricoach-${id}-0`)).toMatchObject({ status: "failed", remote_id: null });
    expect((await rows()).find((r) => r.external_id === `tricoach-${id}-0`)!.last_error).toMatch(/durée libre/);
  });

  it("lot refusé : chaque séance est redéposée seule, seule la fautive reste en échec", async () => {
    const good = await session(addDays(today, 4), "published", bikeThreshold, "Bonne");
    const bad = await session(addDays(today, 5), "published", bikeThreshold, "Refusée");
    fake.reject.add(`tricoach-${bad}-0`);
    await run();
    expect(events().map((e) => e.name)).toEqual(["Bonne"]);
    expect((await rows()).find((r) => r.external_id === `tricoach-${good}-0`)?.status).toBe("sent");
    expect((await rows()).find((r) => r.external_id === `tricoach-${bad}-0`)).toMatchObject({
      status: "failed",
      last_error: "intervals.icu a refusé cette séance : elle est à revoir dans TriCoach.",
    });
    fake.reject.clear();
    expect(await resendIntervals(deps, athleteId)).toBe(true);
    await run();
    expect(events().map((e) => e.name).sort()).toEqual(["Bonne", "Refusée"]);
  });

  it("quota (429) : report sans échec ; clé retirée chez intervals.icu : reconnexion demandée", async () => {
    fake.rateLimitNext = 1;
    await admin.from("planned_sessions").update({ title: "Bonne, modifiée" }).eq("scheduled_date", addDays(today, 4)).eq("athlete_id", athleteId);
    expect(await run()).toMatchObject({ deferred: 1, failed: 0 });
    await admin.from("provider_state").update({ blocked_until: null }).eq("provider", "intervals");
    await admin.from("sync_jobs").update({ run_after: new Date().toISOString() }).eq("athlete_id", athleteId).eq("kind", "intervals_sync").eq("status", "failed");
    await run();
    expect(events().map((e) => e.name).sort()).toEqual(["Bonne, modifiée", "Refusée"]);

    fake.keys.delete(key);
    await nudge();
    await run();
    expect((await connection())!.status).toBe("reauth_required");
    const { data: notes } = await admin.from("notifications").select("payload").eq("recipient_id", athleteId).eq("kind", "reconnect");
    expect(notes?.some((n) => (n.payload as { provider?: string }).provider === "intervals")).toBe(true);
  });

  it("nouvelle clé puis déconnexion : les séances à venir quittent le calendrier, la clé est effacée", async () => {
    fake.addKey(key, athlete);
    expect(await connectIntervals(deps, athleteId, key)).toEqual({ status: "connected" });
    await run();
    expect(events().length).toBeGreaterThan(0);
    expect(await disconnectIntervals(deps, athleteId)).toEqual({ removed: true });
    expect(events()).toEqual([]);
    expect(await connection()).toBeNull();
    expect(await rows()).toEqual([]);
  });
});
