/**
 * Connexion à intervals.icu par « Autoriser » (OAuth avec PKCE), contre une vraie pile Supabase et
 * un faux intervals.icu : code refusé sans le bon vérificateur, jeton gardé chiffré avec les
 * autorisations accordées, envois et lectures en « Bearer », déliaison qui retire l'autorisation.
 * Données entièrement fictives.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IntervalsApi } from "@/lib/intervals/api";
import { pkceChallenge } from "@/lib/intervals/oauth";
import { compareIntervalsThresholds, connectIntervalsOAuth, disconnectIntervals, runIntervalsJobs, type IntervalsDeps } from "@/lib/intervals/service";
import { addDays } from "@/lib/planning/dates";
import type { Database } from "@/lib/supabase/database.types";
import { localDate } from "@/lib/utils";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";
import { FakeIntervals } from "../fixtures/fake-intervals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("intervals.icu relié par « Autoriser »", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeIntervals();
  const deps: IntervalsDeps = { admin, api: new IntervalsApi("https://fake.intervals.test", fake.fetch), key: randomBytes(32), now: () => new Date() };
  const athlete = `i${Math.floor(Math.random() * 1e6)}`;
  const client = { clientId: "e2e-client", clientSecret: "e2e-secret" };
  const verifier = randomBytes(32).toString("base64url");
  let athleteId = "";

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `oauth-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète autorisé", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    await admin.from("athlete_thresholds").insert({ athlete_id: athleteId, sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" });
    const parsed = parseWorkout(bikeThreshold);
    if (!parsed.success) throw new Error("fixture");
    await admin
      .from("planned_sessions")
      .insert({ athlete_id: athleteId, scheduled_date: addDays(localDate("Europe/Paris"), 2), sport: "bike", title: "Seuil autorisé", content: parsed.data, state: "published" });
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("sans le bon vérificateur (PKCE) ou avec un code déjà servi : refusé, rien n'est relié", async () => {
    const code = fake.authorize(athlete, pkceChallenge(verifier));
    expect(await connectIntervalsOAuth(deps, athleteId, { code, verifier: "mauvais-verificateur-0000000000000000000000", ...client })).toEqual({ status: "denied" });
    expect(await connectIntervalsOAuth(deps, athleteId, { code, verifier, ...client })).toEqual({ status: "denied" });
    const { data } = await admin.from("external_connections").select("id").eq("athlete_id", athleteId).eq("provider", "intervals");
    expect(data).toEqual([]);
  });

  it("autorisé : jeton chiffré, autorisations gardées, séances envoyées et seuils lus en « Bearer »", async () => {
    const code = fake.authorize(athlete, pkceChallenge(verifier));
    expect(await connectIntervalsOAuth(deps, athleteId, { code, verifier, ...client })).toEqual({ status: "connected" });
    const { data: connection } = await admin.from("external_connections").select("id, external_athlete_id, scopes, status").eq("athlete_id", athleteId).eq("provider", "intervals").single();
    expect(connection).toMatchObject({ external_athlete_id: athlete, scopes: ["ACTIVITY:READ", "WELLNESS:READ", "CALENDAR:WRITE", "SETTINGS:WRITE"], status: "active" });
    const { data: token } = await admin.from("oauth_tokens").select("access_token").eq("connection_id", connection!.id).single();
    expect(token!.access_token.startsWith("v1.")).toBe(true);
    expect([...fake.tokens.keys()].some((t) => token!.access_token.includes(t))).toBe(false);

    await runIntervalsJobs(deps, { limit: 5, budgetMs: 30_000 });
    expect(fake.eventsOf(athlete).map((e) => e.name)).toContain("Seuil autorisé");
    const compared = await compareIntervalsThresholds(deps, athleteId);
    expect(compared.status).toBe("ok");
  });

  it("délier : séances retirées et autorisation retirée chez intervals.icu", async () => {
    expect(fake.tokens.size).toBe(1);
    expect(await disconnectIntervals(deps, athleteId)).toEqual({ removed: true });
    expect(fake.eventsOf(athlete)).toEqual([]);
    expect(fake.tokens.size).toBe(0);
    expect(fake.calls).toContain("DELETE /api/v1/disconnect-app");
  });
});
