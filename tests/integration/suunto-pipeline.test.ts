/**
 * Chaîne Suunto complète, contre une vraie pile Supabase et un faux Suunto : connexion, envoi des
 * séances de la fenêtre par la file de jobs, mise à jour à la modification, retrait à l'annulation
 * et à la suppression, renouvellement des jetons, quota, retrait d'accès, déconnexion.
 * Lancement : pile locale démarrée, variables de .env.local-stack chargées.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { runDueJobs, type JobRunner } from "@/lib/strava/service";
import { SuuntoApi } from "@/lib/suunto/api";
import { connectSuunto, disconnectSuunto, enqueueDailySuunto, handleSuuntoJob, pushSession, type SuuntoDeps } from "@/lib/suunto/service";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";
import { FakeSuunto } from "../fixtures/fake-suunto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("chaîne Suunto (séance → guide sur la montre)", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  let clock = new Date();
  const now = () => clock;
  const fake = new FakeSuunto(now);
  const settings = {
    apiBaseUrl: "https://fake.suunto.test",
    oauthBaseUrl: "https://fake.suunto.test/oauth",
    clientId: fake.clientId,
    clientSecret: fake.clientSecret,
    subscriptionKey: fake.subscriptionKey,
    appName: fake.appName,
  };
  const deps: SuuntoDeps = {
    admin,
    api: new SuuntoApi(settings, fake.fetch, now),
    key: randomBytes(32),
    settings,
    siteUrl: "https://tricoach.test",
    now,
  };
  const runner: JobRunner = {
    admin,
    now,
    handlers: {
      suunto_push: (job) => handleSuuntoJob(deps, job),
      suunto_remove: (job) => handleSuuntoJob(deps, job),
    },
  };
  const user = `gerald-${randomUUID().slice(0, 6)}`;
  let athleteId = "";
  const day = (offset: number) => {
    const d = new Date(clock);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const content = parseWorkout(bikeThreshold);
  if (!content.success) throw new Error("fixture");

  const insert = async (scheduled_date: string, state: "draft" | "published" = "published", title = "Seuil 4 × 8 min") => {
    const { data, error } = await admin
      .from("planned_sessions")
      .insert({
        athlete_id: athleteId,
        scheduled_date,
        sport: "bike",
        title,
        content: content.data,
        state,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };
  const guidesOf = async (sessionId: string) =>
    (await admin.from("suunto_guides").select("segment_index, guide_id, status, session_version").eq("session_id", sessionId).order("segment_index")).data ??
    [];
  const drain = async () => {
    for (let i = 0; i < 5; i += 1) await runDueJobs(runner, { limit: 20, budgetMs: 10_000 });
  };

  let soon = "";
  let far = "";
  let past = "";

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `suunto-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: {
        display_name: "Athlète Suunto",
        timezone: "Europe/Paris",
      },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    await admin.from("athlete_thresholds").insert({
      athlete_id: athleteId,
      sport: "bike",
      metric: "ftp_w",
      value: 250,
      effective_from: "2026-01-01",
    });
    soon = await insert(day(2));
    far = await insert(day(30));
    past = await insert(day(-1));
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  it("connecte l'athlète : jetons chiffrés, les séances de la fenêtre partent seules", async () => {
    const result = await connectSuunto(deps, athleteId, fake.issueCode(user));
    expect(result.status).toBe("connected");
    const { data: connection } = await admin
      .from("external_connections")
      .select("external_athlete_id, status")
      .eq("athlete_id", athleteId)
      .eq("provider", "suunto")
      .single();
    expect(connection).toEqual({
      external_athlete_id: user,
      status: "active",
    });
    const { data: tokens } = await admin.from("oauth_tokens").select("access_token, refresh_token");
    expect(JSON.stringify(tokens)).not.toContain("at-");
    expect(JSON.stringify(tokens)).not.toContain("rt-");

    await drain();
    const sent = await guidesOf(soon);
    expect(sent).toEqual([
      {
        segment_index: 0,
        guide_id: expect.stringMatching(/^g-/),
        status: "sent",
        session_version: 1,
      },
    ]);
    expect(await guidesOf(far)).toEqual([]);
    expect(await guidesOf(past)).toEqual([]);
    const guide = fake.guides.get(sent[0].guide_id as string)!;
    expect(guide.user).toBe(user);
    expect(guide.guide).toMatchObject({
      name: "Seuil 4 × 8 min",
      owner: "TriCoach",
      localDate: day(2),
      externalId: `${soon}:0`,
    });
    const warmup = (guide.guide.steps as { fields: { type: string; min?: number }[] }[])[0];
    expect(warmup.fields[0]).toMatchObject({ type: "targetPower", min: 138 }); // 55 % de 250 W
  });

  it("une modification du coach met le guide à jour sans doublon ; un titre changé aussi", async () => {
    const before = (await guidesOf(soon))[0].guide_id as string;
    await admin.from("planned_sessions").update({ title: "Seuil 4 × 8 min (v2)" }).eq("id", soon);
    await drain();
    const after = await guidesOf(soon);
    expect(after[0].guide_id).toBe(before);
    expect(after[0].session_version).toBe(2);
    expect(fake.guides.get(before)?.name).toBe("Seuil 4 × 8 min (v2)");
    expect([...fake.guides.values()].filter((g) => g.user === user)).toHaveLength(1);
  });

  it("un guide supprimé depuis l'appli Suunto est recréé au prochain envoi", async () => {
    const before = (await guidesOf(soon))[0].guide_id as string;
    fake.guides.delete(before);
    const result = await pushSession(deps, athleteId, soon);
    expect(result.status).toBe("pushed");
    const after = (await guidesOf(soon))[0];
    expect(after.status).toBe("sent");
    expect(after.guide_id).not.toBe(before);
    expect(fake.guides.has(after.guide_id as string)).toBe(true);
  });

  it("un brouillon ne part pas ; publié, il part ; annulé, il est retiré", async () => {
    const draft = await insert(day(5), "draft", "Brouillon");
    await drain();
    expect(await guidesOf(draft)).toEqual([]);
    await admin.from("planned_sessions").update({ state: "published" }).eq("id", draft);
    await drain();
    const [sent] = await guidesOf(draft);
    expect(sent.status).toBe("sent");
    await admin.from("planned_sessions").update({ state: "cancelled" }).eq("id", draft);
    await drain();
    expect((await guidesOf(draft))[0].status).toBe("removed");
    expect(fake.guides.has(sent.guide_id as string)).toBe(false);
  });

  it("la suppression de la séance retire le guide de la montre", async () => {
    const [sent] = await guidesOf(soon);
    await admin.from("planned_sessions").delete().eq("id", soon);
    await drain();
    expect(fake.guides.has(sent.guide_id as string)).toBe(false);
    const { data: jobs } = await admin.from("sync_jobs").select("status").eq("dedupe_key", `suunto:remove:${soon}`);
    expect(jobs).toEqual([{ status: "done" }]);
  });

  it("la tâche quotidienne envoie une séance entrée dans la fenêtre ; le jeton expiré est renouvelé", async () => {
    clock = new Date(clock.getTime() + 20 * 86_400_000); // J+20 : la séance « far » (J+30) est à 10 jours
    fake.tokenTtl = 3600;
    expect(await enqueueDailySuunto(deps)).toBeGreaterThanOrEqual(1); // d'autres athlètes de la pile peuvent être reliés
    const calls = fake.calls.length;
    await drain();
    expect((await guidesOf(far))[0]?.status).toBe("sent");
    expect(fake.calls.slice(calls)).toContain("POST /oauth/token");
    const { data: tokens } = await admin.from("oauth_tokens").select("revision");
    expect(Math.max(...(tokens ?? []).map((t) => t.revision))).toBeGreaterThanOrEqual(2);
  });

  it("quota atteint : le job est reporté, pas compté comme échec, puis réussit", async () => {
    const session = await insert(day(3), "published", "Après quota");
    fake.nextFailure = { status: 429, retryAfter: 1 };
    const report = await runDueJobs(runner, { limit: 20, budgetMs: 10_000 });
    expect(report.deferred).toBe(1);
    expect(report.failed).toBe(0);
    const { data: state } = await admin.from("provider_state").select("blocked_until").eq("provider", "suunto").single();
    expect(state?.blocked_until).toBeTruthy();
    clock = new Date(clock.getTime() + 5000);
    await admin
      .from("sync_jobs")
      .update({ run_after: new Date(0).toISOString() })
      .eq("dedupe_key", `suunto:push:${session}:v1`);
    await drain();
    expect((await guidesOf(session))[0]?.status).toBe("sent");
  });

  it("accès retiré chez Suunto : la connexion passe en reconnexion nécessaire, le job meurt", async () => {
    fake.revokeUser(user);
    await admin
      .from("oauth_tokens")
      .update({ expires_at: new Date(0).toISOString() })
      .gte("revision", 0);
    const session = await insert(day(4), "published", "Après révocation");
    const report = await runDueJobs(runner, { limit: 20, budgetMs: 10_000 });
    expect(report.failed).toBe(1);
    const { data: connection } = await admin.from("external_connections").select("status").eq("athlete_id", athleteId).eq("provider", "suunto").single();
    expect(connection?.status).toBe("reauth_required");
    const { data: job } = await admin.from("sync_jobs").select("status, last_error").eq("dedupe_key", `suunto:push:${session}:v1`).single();
    expect(job).toEqual({ status: "dead", last_error: "reauth_required" });
    expect(await pushSession(deps, athleteId, session)).toEqual({
      status: "skipped",
      reason: "not_connected",
    });
  });

  it("reconnexion puis déconnexion : guides retirés, connexion et jetons effacés", async () => {
    expect((await connectSuunto(deps, athleteId, fake.issueCode(user))).status).toBe("connected");
    await drain();
    expect([...fake.guides.values()].filter((g) => g.user === user).length).toBeGreaterThan(0);
    const result = await disconnectSuunto(deps, athleteId);
    expect(result.failed).toBe(0);
    expect(result.removed).toBeGreaterThan(0);
    expect([...fake.guides.values()].filter((g) => g.user === user)).toEqual([]);
    const { data: connection } = await admin.from("external_connections").select("id").eq("athlete_id", athleteId).eq("provider", "suunto");
    expect(connection).toEqual([]);
    expect((await admin.from("suunto_guides").select("id").eq("athlete_id", athleteId)).data).toEqual([]);
  });
});
