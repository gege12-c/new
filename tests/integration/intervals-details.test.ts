/**
 * Rattrapage des détails (courbes, intervalles, records) des activités de l'année reçues
 * d'intervals.icu, contre une vraie pile Supabase et un faux intervals.icu : ordre de lecture (les
 * 14 derniers jours, puis le vélo, puis la course et la natation, puis le reste), lots, reste annoncé,
 * un seul lecteur à la fois par compte, quota respecté, clé refusée signalée. Données fictives.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntervalsApi } from "@/lib/intervals/api";
import { connectIntervals, readIntervalsDetails, type IntervalsDeps } from "@/lib/intervals/service";
import { addDays } from "@/lib/planning/dates";
import type { Database } from "@/lib/supabase/database.types";
import { localDate } from "@/lib/utils";
import { FakeIntervals } from "../fixtures/fake-intervals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("détails des activités de l'année, rattrapés", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeIntervals();
  const deps: IntervalsDeps = { admin, api: new IntervalsApi("https://fake.intervals.test", fake.fetch), key: randomBytes(32), now: () => new Date() };
  const athlete = `d${Math.floor(Math.random() * 1e6)}`;
  const key = `key${randomUUID().replace(/-/g, "")}`;
  const today = localDate("Europe/Paris");
  let athleteId = "";
  let connectionId = "";
  const ids = new Map<string, string>();

  const SECONDS = Array.from({ length: 1200 }, (_, i) => i);
  // Activités de l'année (identifiant chez intervals.icu, discipline, jours avant aujourd'hui).
  const ACTIVITIES: [string, "Ride" | "Run" | "Swim" | "Walk", number][] = [
    ["w20", "Walk", 20],
    ["b200", "Ride", 200],
    ["r3", "Run", 3],
    ["s60", "Swim", 60],
    ["b40", "Ride", 40],
    ["r90", "Run", 90],
  ];
  const streamsRead = () =>
    fake.calls
      .map((call) => /\/activity\/([^/]+)\/streams\.json/.exec(call)?.[1])
      .filter((id): id is string => Boolean(id));
  const withDetails = async () => {
    const { data } = await admin.from("activity_streams").select("activity_id, metrics").in("activity_id", [...ids.values()]);
    const byId = new Map([...ids].map(([external, id]) => [id, external]));
    return (data ?? []).filter((row) => (row.metrics as { v?: number } | null)?.v === 2).map((row) => byId.get(row.activity_id)!).sort();
  };

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `intervals-details-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète détails", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    fake.addKey(key, athlete);
    expect(await connectIntervals(deps, athleteId, key)).toEqual({ status: "connected" });
    // La synchronisation mise en file à la connexion n'est pas lancée : seul le rattrapage lit les détails.
    await admin.from("sync_jobs").delete().eq("athlete_id", athleteId);
    const { data: connection } = await admin.from("external_connections").select("id").eq("athlete_id", athleteId).eq("provider", "intervals").single();
    connectionId = connection!.id;
    for (const [external, type, daysAgo] of ACTIVITIES) {
      const day = addDays(today, -daysAgo);
      fake.addActivity(athlete, {
        id: external,
        start_date_local: `${day}T07:00:00`,
        type,
        _streams: [
          { type: "time", data: SECONDS },
          { type: "heartrate", data: SECONDS.map(() => 140) },
          ...(type === "Ride" ? [{ type: "watts", data: SECONDS.map(() => 200) }] : []),
        ],
      });
      const { data: row, error: insertError } = await admin
        .from("activities")
        .insert({
          athlete_id: athleteId,
          source: "intervals",
          external_id: external,
          sport: type === "Ride" ? "bike" : type === "Run" ? "run" : type === "Swim" ? "swim" : "other",
          sport_detail: type,
          start_time: `${day}T05:00:00Z`,
          local_date: day,
          local_start_time: "07:00:00",
          moving_s: 1200,
          elapsed_s: 1200,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      ids.set(external, row.id);
    }
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("lot après lot : récentes, puis vélo, puis course et natation, puis le reste ; le reste est annoncé", async () => {
    const first = await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000, max: 3 });
    expect(first).toEqual({ status: "ok", read: 3, remaining: 3, total: 6, paused: false });
    expect(await withDetails()).toEqual(["b200", "b40", "r3"]);
    // Dans chaque groupe, de la plus récente à la plus ancienne.
    expect(streamsRead().slice(0, 3)).toEqual(["r3", "b40", "b200"]);

    const second = await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 });
    expect(second).toEqual({ status: "ok", read: 3, remaining: 0, total: 6, paused: false });
    expect(streamsRead().slice(3)).toEqual(["s60", "r90", "w20"]);
    expect(await withDetails()).toEqual(["b200", "b40", "r3", "r90", "s60", "w20"]);

    // Plus rien à lire : aucun appel à intervals.icu.
    const calls = fake.calls.length;
    expect(await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 })).toEqual({ status: "ok", read: 0, remaining: 0, total: 6, paused: false });
    expect(fake.calls.length).toBe(calls);
  });

  it("un seul lecteur à la fois : compte déjà en cours de synchronisation, la demande attend son tour", async () => {
    const { data: leased } = await admin.rpc("acquire_sync_lease", { p_connection: connectionId, p_seconds: 60 });
    expect(leased).toBe(true);
    expect(await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 })).toEqual({ status: "busy" });
    await admin.rpc("release_sync_lease", { p_connection: connectionId });
  });

  it("quota atteint chez intervals.icu : la lecture s'arrête, sans rien noter, et reprend ensuite", async () => {
    await admin.from("activity_streams").update({ metrics: {} }).eq("activity_id", ids.get("b40")!);
    fake.rateLimitNext = 1;
    expect(await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 })).toEqual({ status: "ok", read: 0, remaining: 1, total: 6, paused: true });
    expect(await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 })).toEqual({ status: "ok", read: 1, remaining: 0, total: 6, paused: false });
  });

  it("clé refusée : la connexion passe « à renouveler », rien d'autre n'est tenté", async () => {
    await admin.from("activity_streams").update({ metrics: {} }).eq("activity_id", ids.get("r3")!);
    fake.keys.delete(key);
    expect(await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 })).toEqual({ status: "reauth" });
    const { data: connection } = await admin.from("external_connections").select("status").eq("id", connectionId).single();
    expect(connection!.status).toBe("reauth_required");
    expect(await readIntervalsDetails(deps, athleteId, { budgetMs: 30_000 })).toEqual({ status: "reauth" });
  });

  it("sans compte relié : rien à lire", async () => {
    expect(await readIntervalsDetails(deps, randomUUID(), { budgetMs: 30_000 })).toEqual({ status: "not_linked" });
  });
});
