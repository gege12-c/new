/**
 * Chaîne Strava complète, contre une vraie pile Supabase (base, API, authentification) et un faux
 * Strava : connexion, webhook, dédoublonnage, rapprochement, suppression, renouvellement des jetons,
 * quotas, retrait d'accès. Lancement : pile locale démarrée, variables de .env.local-stack chargées.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { connectStrava, disconnectStrava, enqueueWebhookEvent, makeStravaApi, runDueJobs, type StravaDeps } from "@/lib/strava/service";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";
import { FakeStrava, fakeActivity } from "../fixtures/fake-strava";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("chaîne Strava (webhook → activité → séance)", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeStrava();
  const settings = {
    apiBaseUrl: "https://fake.strava.test/api/v3",
    oauthBaseUrl: "https://fake.strava.test/oauth",
    clientId: fake.clientId,
    clientSecret: fake.clientSecret,
    webhookVerifyToken: "verify",
  };
  const deps: StravaDeps = { admin, api: makeStravaApi(settings, admin, fake.fetch), key: randomBytes(32), settings, now: () => new Date() };
  const stravaId = 700_000 + Math.floor(Math.random() * 99_999);
  const subscriptionId = 990_000 + Math.floor(Math.random() * 9999);
  let athleteId = "";
  let morning = "";
  let evening = "";
  const today = new Date();
  const localDay = new Date(today.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
  const at = (hourUtc: number) => new Date(`${localDay}T${String(hourUtc).padStart(2, "0")}:00:00Z`);
  let eventTime = Math.floor(Date.now() / 1000);
  const event = (objectId: number, aspect: "create" | "update" | "delete", updates: Record<string, string> = {}, objectType: "activity" | "athlete" = "activity") => ({
    object_type: objectType,
    object_id: objectId,
    aspect_type: aspect,
    owner_id: stravaId,
    subscription_id: subscriptionId,
    event_time: ++eventTime,
    updates,
  });
  const stravaActivities = async () =>
    (await admin.from("activities").select("id, external_id, moving_s").eq("athlete_id", athleteId).eq("source", "strava")).data ?? [];

  beforeAll(async () => {
    const { data: user, error } = await admin.auth.admin.createUser({
      email: `strava-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète intégration", timezone: "Europe/Paris" },
    });
    if (error || !user.user) throw error ?? new Error("compte non créé");
    athleteId = user.user.id;
    const content = parseWorkout(bikeThreshold);
    if (!content.success) throw new Error("fixture");
    const insert = async (start_time: string, planned: number) => {
      const { data, error: e } = await admin
        .from("planned_sessions")
        .insert({ athlete_id: athleteId, scheduled_date: localDay, start_time, sport: "run", title: "Course", content: content.data, state: "published", planned_duration_s: planned })
        .select("id")
        .single();
      if (e) throw e;
      return data.id;
    };
    morning = await insert("07:00", 2700);
    evening = await insert("18:30", 3600);
    await admin.from("provider_state").upsert({ provider: "strava", subscription_id: subscriptionId }, { onConflict: "provider" });
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("connecte l'athlète : jetons chiffrés, import des derniers jours", async () => {
    fake.addAthlete(stravaId, "Léa", "Test");
    fake.addActivity(stravaId, fakeActivity(stravaId * 10 + 1, at(5), { minutes: 46 })); // 07:00 heure de Paris
    const result = await connectStrava(deps, athleteId, fake.issueCode(stravaId), "read,activity:read_all");
    expect(result.status).toBe("connected");

    const { data: tokens } = await admin.from("oauth_tokens").select("access_token, refresh_token");
    const mine = (tokens ?? []).filter((t) => t.access_token.startsWith("v1."));
    expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(tokens)).not.toContain("acc-");
    expect(JSON.stringify(tokens)).not.toContain("ref-");

    await runDueJobs(deps);
    const activities = await stravaActivities();
    expect(activities).toHaveLength(1);
    const { data: match } = await admin.from("session_activity_matches").select("session_id, status").eq("activity_id", activities[0].id);
    expect(match).toEqual([{ session_id: morning, status: "auto" }]);
  });

  it("une activité arrive par webhook, sans doublon, rattachée à la bonne séance", async () => {
    const id = stravaId * 10 + 2;
    fake.addActivity(stravaId, fakeActivity(id, at(16, ), { minutes: 61 })); // 18:00 heure de Paris
    const created = event(id, "create");
    expect(await enqueueWebhookEvent(deps, created)).toBe("queued");
    // Strava renvoie le même évènement (pas de réponse à temps) : un seul job.
    expect(await enqueueWebhookEvent(deps, created)).toBe("queued");
    const { count } = await admin.from("sync_jobs").select("id", { count: "exact", head: true }).like("dedupe_key", `strava:event:activity:${id}:%`);
    expect(count).toBe(1);

    await runDueJobs(deps);
    const activities = await stravaActivities();
    expect(activities.map((a) => a.external_id).sort()).toEqual([String(stravaId * 10 + 1), String(id)].sort());
    const fresh = activities.find((a) => a.external_id === String(id))!;
    const { data: match } = await admin.from("session_activity_matches").select("session_id, status").eq("activity_id", fresh.id);
    expect(match).toEqual([{ session_id: evening, status: "auto" }]);

    // Modification chez Strava : relue, toujours une seule activité.
    fake.addActivity(stravaId, { ...fakeActivity(id, at(16), { minutes: 50 }) });
    await enqueueWebhookEvent(deps, event(id, "update", { title: "Fractionné" }));
    await runDueJobs(deps);
    const updated = (await stravaActivities()).filter((a) => a.external_id === String(id));
    expect(updated).toEqual([{ id: fresh.id, external_id: String(id), moving_s: 3000 }]);
  });

  it("ignore les évènements d'un autre abonnement ou d'un inconnu", async () => {
    expect(await enqueueWebhookEvent(deps, { ...event(1, "create"), subscription_id: 1 })).toBe("ignored");
    expect(await enqueueWebhookEvent(deps, { ...event(1, "create"), owner_id: 1 })).toBe("ignored");
  });

  it("une suppression n'est appliquée qu'après vérification chez Strava", async () => {
    const id = stravaId * 10 + 2;
    // Faux évènement : l'activité existe encore chez Strava, elle reste.
    await enqueueWebhookEvent(deps, event(id, "delete"));
    await runDueJobs(deps);
    expect((await stravaActivities()).some((a) => a.external_id === String(id))).toBe(true);
    // Vraie suppression.
    fake.removeActivity(stravaId, id);
    await enqueueWebhookEvent(deps, event(id, "delete"));
    await runDueJobs(deps);
    expect((await stravaActivities()).some((a) => a.external_id === String(id))).toBe(false);
  });

  it("renouvelle un jeton expiré et garde le nouveau", async () => {
    fake.expireTokens();
    await admin.from("oauth_tokens").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).neq("revision", -1);
    const before = await admin.from("oauth_tokens").select("revision, refresh_token");
    fake.addActivity(stravaId, fakeActivity(stravaId * 10 + 3, at(9), { minutes: 30, sport: "Ride" }));
    await enqueueWebhookEvent(deps, event(stravaId * 10 + 3, "create"));
    const report = await runDueJobs(deps);
    expect(report.failed).toBe(0);
    const after = await admin.from("oauth_tokens").select("revision, refresh_token");
    const changed = (after.data ?? []).filter((row) => !(before.data ?? []).some((b) => b.refresh_token === row.refresh_token));
    expect(changed.length).toBeGreaterThan(0);
    expect((await stravaActivities()).some((a) => a.external_id === String(stravaId * 10 + 3))).toBe(true);
  });

  it("reporte le travail quand le quota est presque atteint, sans compter d'échec", async () => {
    fake.usage.r15 = fake.usage.readLimit15 - 5;
    fake.usage.u15 = 10;
    const id = stravaId * 10 + 4;
    fake.addActivity(stravaId, fakeActivity(id, at(10), { minutes: 20 }));
    await enqueueWebhookEvent(deps, event(id, "create"));
    await runDueJobs(deps); // cette lecture fait remonter le quota
    await enqueueWebhookEvent(deps, event(id, "update", { title: "x" }));
    const report = await runDueJobs(deps);
    expect(report.deferred).toBeGreaterThanOrEqual(1);
    const { data: jobs } = await admin.from("sync_jobs").select("status, attempts, run_after, last_error").eq("athlete_id", athleteId).eq("status", "failed");
    expect(jobs?.[0]).toMatchObject({ status: "failed", attempts: 0, last_error: "rate_limited" });
    expect(new Date(jobs![0].run_after).getTime()).toBeGreaterThan(Date.now());
    // Fenêtre suivante : le quota se libère.
    fake.usage.r15 = 0;
    await admin.from("provider_state").update({ rate_limit: null, blocked_until: null }).eq("provider", "strava");
    await admin.from("sync_jobs").update({ run_after: new Date().toISOString() }).eq("athlete_id", athleteId).eq("status", "failed");
    expect((await runDueJobs(deps)).failed).toBe(0);
  });

  it("le retrait d'accès chez Strava efface aussitôt connexion, jetons et activités", async () => {
    fake.deauthorize(stravaId);
    await admin.from("oauth_tokens").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).neq("revision", -1);
    await enqueueWebhookEvent(deps, event(stravaId, "update", { authorized: "false" }, "athlete"));
    await runDueJobs(deps);
    const { data: connections } = await admin.from("external_connections").select("id").eq("athlete_id", athleteId);
    expect(connections).toEqual([]);
    expect(await stravaActivities()).toEqual([]);
  });

  it("la déconnexion depuis TriCoach révoque l'accès chez Strava", async () => {
    await connectStrava(deps, athleteId, fake.issueCode(stravaId), "read,activity:read_all");
    expect(fake.athletes.get(stravaId)?.authorized).toBe(true);
    const { revoked } = await disconnectStrava(deps, athleteId);
    expect(revoked).toBe(true);
    expect(fake.athletes.get(stravaId)?.authorized).toBe(false);
    const { data: connections } = await admin.from("external_connections").select("id").eq("athlete_id", athleteId);
    expect(connections).toEqual([]);
  });

  it("refuse une connexion sans accès aux activités", async () => {
    const result = await connectStrava(deps, athleteId, fake.issueCode(stravaId, "read"), "read");
    expect(result.status).toBe("missing_scope");
  });
});
