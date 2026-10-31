/**
 * Envoi des séances sur la montre Suunto, de bout en bout, contre une vraie pile Supabase (base,
 * API, triggers) et un faux Suunto : connexion, envoi, mise à jour, annulation, rattrapage d'un
 * guide effacé, ménage des guides orphelins, refus, jetons renouvelés, quota, accès retiré,
 * déconnexion. Lancement : pile locale démarrée, variables de .env.local-stack chargées.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/planning/dates";
import type { Database } from "@/lib/supabase/database.types";
import { connectSuunto, disconnectSuunto, makeSuuntoApi, resendSuunto, runSuuntoJobs, type SuuntoDeps } from "@/lib/suunto/service";
import { localDate } from "@/lib/utils";
import { bikeThreshold, brick } from "@/lib/workout/fixtures";
import { parseWorkout } from "@/lib/workout/schema";
import { FakeSuunto } from "../fixtures/fake-suunto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !serviceKey)("montre Suunto (séance → guide → montre)", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const fake = new FakeSuunto();
  const settings = {
    clientId: fake.clientId,
    clientSecret: fake.clientSecret,
    subscriptionKey: fake.subscriptionKey,
    appName: fake.appName,
    apiBaseUrl: "https://fake.suunto.test",
    oauthBaseUrl: "https://fake.suunto.test/oauth",
  };
  const deps: SuuntoDeps = {
    admin,
    api: makeSuuntoApi(settings, fake.fetch),
    key: randomBytes(32),
    settings,
    siteUrl: "https://tricoach.test",
    now: () => new Date(),
    pause: async () => undefined,
    writeGapMs: 0,
  };
  const user = `athlete-${randomUUID().slice(0, 8)}`;
  const today = localDate("Europe/Paris");
  let athleteId = "";

  const run = (with_: SuuntoDeps = deps) => runSuuntoJobs(with_, { limit: 20, budgetMs: 30_000 });
  const guides = () => fake.guidesOf(user);
  const ours = () => guides().filter((g) => g.externalId?.startsWith("tricoach-"));
  const rows = async () => (await admin.from("device_workouts").select("external_id, status, remote_id, session_version, last_error").eq("athlete_id", athleteId).eq("provider", "suunto")).data ?? [];
  const nudge = async () => admin.from("sync_jobs").insert({ kind: "suunto_sync", athlete_id: athleteId });
  const connection = async () =>
    (await admin.from("external_connections").select("id, status, last_error, last_sync_at").eq("athlete_id", athleteId).eq("provider", "suunto").maybeSingle()).data;

  async function session(date: string, state: "draft" | "published", content: unknown = bikeThreshold, title = "Seuil 4 × 8 min") {
    const parsed = parseWorkout(content);
    if (!parsed.success) throw new Error("fixture");
    const { data, error } = await admin
      .from("planned_sessions")
      .insert({ athlete_id: athleteId, scheduled_date: date, sport: parsed.data.segments.length > 1 ? "brick" : "bike", title, content: parsed.data, state })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `suunto-${randomUUID().slice(0, 8)}@integration.local`,
      password: "Integration-2026",
      email_confirm: true,
      user_metadata: { display_name: "Athlète Suunto", timezone: "Europe/Paris" },
    });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    athleteId = data.user.id;
    await admin.from("athlete_thresholds").insert({ athlete_id: athleteId, sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" });
  });

  afterAll(async () => {
    if (athleteId) await admin.auth.admin.deleteUser(athleteId);
  });

  let sessionA = "";
  let sessionB = "";
  let brickId = "";

  it("connexion : jetons chiffrés, puis envoi des seules séances publiées d'aujourd'hui à J+6", async () => {
    expect(await connectSuunto(deps, athleteId, fake.issueCode(user))).toMatchObject({ status: "connected" });
    const { data: tokens } = await admin.from("oauth_tokens").select("access_token, refresh_token").eq("connection_id", (await connection())!.id).single();
    expect(tokens!.access_token).toMatch(/^v1\./);
    expect(tokens!.access_token).not.toContain("acc-");

    sessionA = await session(addDays(today, 1), "published");
    sessionB = await session(addDays(today, 2), "draft");
    await session(addDays(today, 10), "published");
    await session(addDays(today, -1), "published");
    brickId = await session(addDays(today, 3), "published", brick, "Enchaînement");
    const report = await run();
    expect(report.failed).toBe(0);

    expect(ours().map((g) => g.externalId).sort()).toEqual([`tricoach-${brickId}-0`, `tricoach-${brickId}-1`, `tricoach-${sessionA}-0`].sort());
    const guide = ours().find((g) => g.externalId === `tricoach-${sessionA}-0`)!.guide!;
    expect(guide).toMatchObject({ name: "Seuil 4 × 8 min", owner: "TriCoach", localDate: addDays(today, 1), usage: "workout" });
    expect(guide.url).toBe(`https://tricoach.test/athlete/calendar?view=day&date=${addDays(today, 1)}&session=${sessionA}`);
    // Cibles en watts, calculées avec la FTP de l'athlète (250 W).
    const warmup = guide.steps[0];
    expect(warmup.type === "fields" ? warmup.fields[0] : null).toMatchObject({ type: "targetPower", min: 138, max: 175 });
    expect((await rows()).map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect((await connection())!.last_sync_at).not.toBeNull();
  });

  it("séance modifiée : le guide est remplacé, sans doublon ; annulée : il est retiré", async () => {
    const before = ours().find((g) => g.externalId === `tricoach-${sessionA}-0`)!.id;
    await admin.from("planned_sessions").update({ title: "Seuil, version 2" }).eq("id", sessionA);
    await run();
    const after = ours().filter((g) => g.externalId === `tricoach-${sessionA}-0`);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before, name: "Seuil, version 2" });
    const row = (await rows()).find((r) => r.external_id === `tricoach-${sessionA}-0`)!;
    expect(row.session_version).toBeGreaterThan(1);

    await admin.from("planned_sessions").update({ state: "cancelled" }).eq("id", sessionA);
    await run();
    expect(ours().some((g) => g.externalId === `tricoach-${sessionA}-0`)).toBe(false);
    expect((await rows()).some((r) => r.external_id === `tricoach-${sessionA}-0`)).toBe(false);
  });

  it("brouillon publié : il part ; guide effacé dans l'appli Suunto : il revient au passage suivant", async () => {
    await admin.from("planned_sessions").update({ state: "published" }).eq("id", sessionB);
    await run();
    const sent = ours().find((g) => g.externalId === `tricoach-${sessionB}-0`)!;
    expect(sent).toBeDefined();
    fake.guides.delete(sent.id);
    await nudge();
    await run();
    const back = ours().find((g) => g.externalId === `tricoach-${sessionB}-0`)!;
    expect(back.id).not.toBe(sent.id);
    expect((await rows()).find((r) => r.external_id === `tricoach-${sessionB}-0`)!.remote_id).toBe(back.id);
  });

  it("ménage : un guide TriCoach orphelin est retiré, un guide d'une autre application reste", async () => {
    const orphan = fake.addForeignGuide(user, { externalId: `tricoach-${randomUUID()}-0`, owner: "TriCoach" });
    const foreign = fake.addForeignGuide(user, { externalId: null, owner: "Autre application", name: "Pyramide" });
    await nudge();
    await run();
    expect(fake.guides.has(orphan)).toBe(false);
    expect(fake.guides.has(foreign)).toBe(true);
    // Rien d'autre n'a bougé : trois guides TriCoach (B et l'enchaînement en deux parties ; A est annulée).
    expect(ours()).toHaveLength(3);
  });

  it("réponse de création sans identifiant : relu dans la liste", async () => {
    fake.omitIdOnCreate = true;
    const id = await session(addDays(today, 4), "published", bikeThreshold, "Sans identifiant");
    await run();
    fake.omitIdOnCreate = false;
    const created = ours().find((g) => g.externalId === `tricoach-${id}-0`)!;
    expect((await rows()).find((r) => r.external_id === `tricoach-${id}-0`)).toMatchObject({ status: "sent", remote_id: created.id });
  });

  it("guide refusé par Suunto : la raison est gardée, pas de nouvel essai identique, renvoi à la demande", async () => {
    fake.rejectNext = 1;
    const id = await session(addDays(today, 5), "published", bikeThreshold, "Refusée");
    await run();
    expect((await rows()).find((r) => r.external_id === `tricoach-${id}-0`)).toMatchObject({
      status: "failed",
      remote_id: null,
      last_error: "Suunto a refusé ce guide : la séance est à revoir dans TriCoach.",
    });
    const posts = fake.calls.filter((c) => c === "POST /v2/guides/files").length;
    await nudge();
    await run();
    expect(fake.calls.filter((c) => c === "POST /v2/guides/files").length).toBe(posts);
    expect(await resendSuunto(deps, athleteId)).toBe(true);
    await run();
    expect((await rows()).find((r) => r.external_id === `tricoach-${id}-0`)).toMatchObject({ status: "sent" });
  });

  it("jetons expirés : renouvelés (le jeton de renouvellement change), envoi poursuivi", async () => {
    const { data: before } = await admin.from("oauth_tokens").select("revision").eq("connection_id", (await connection())!.id).single();
    fake.expireTokens();
    await admin.from("planned_sessions").update({ title: "Après renouvellement" }).eq("id", sessionB);
    await run();
    const { data: after } = await admin.from("oauth_tokens").select("revision").eq("connection_id", (await connection())!.id).single();
    expect(after!.revision).toBe(before!.revision + 1);
    expect(ours().find((g) => g.externalId === `tricoach-${sessionB}-0`)!.name).toBe("Après renouvellement");
  });

  it("deux exécutants en même temps : un seul envoi par compte, aucun doublon", async () => {
    await session(addDays(today, 6), "published", bikeThreshold, "Concurrence");
    await nudge();
    await Promise.all([run(), run()]);
    const ids = ours().map((g) => g.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("quota de Suunto (401 « RateLimitExceeded ») : envoi reporté sans échec ni reconnexion", async () => {
    fake.rateLimitNext = 1;
    await nudge();
    const report = await run();
    expect(report).toMatchObject({ deferred: 1, failed: 0 });
    expect((await connection())!.status).toBe("active");
    const { data: state } = await admin.from("provider_state").select("blocked_until").eq("provider", "suunto").single();
    expect(new Date(state!.blocked_until!).getTime()).toBeGreaterThan(Date.now());
    // Tant que le report court, rien ne part.
    expect(await run()).toEqual({ done: 0, failed: 0, deferred: 0 });
    await admin.from("provider_state").update({ blocked_until: null }).eq("provider", "suunto");
    await admin.from("sync_jobs").update({ run_after: new Date().toISOString() }).eq("athlete_id", athleteId).eq("kind", "suunto_sync").eq("status", "failed");
    expect((await run()).done).toBeGreaterThan(0);
  });

  it("nom d'application différent de celui enregistré chez Suunto : signalé, sans marquer les séances", async () => {
    const wrong = { ...settings, appName: "Autre nom" };
    const misconfigured: SuuntoDeps = { ...deps, settings: wrong, api: makeSuuntoApi(wrong, fake.fetch) };
    await session(addDays(today, 6), "published", bikeThreshold, "Nom faux");
    const report = await run(misconfigured);
    expect(report.failed).toBe(1);
    expect((await connection())!.last_error).toBe("app_name_mismatch");
    expect((await rows()).every((r) => r.last_error !== "Suunto a refusé ce guide : la séance est à revoir dans TriCoach.")).toBe(true);
    await nudge();
    await run();
    expect((await connection())!.last_error).toBeNull();
  });

  it("accès retiré chez Suunto : reconnexion demandée à l'athlète, plus aucun envoi", async () => {
    fake.revoke(user);
    await nudge();
    await run();
    expect((await connection())!.status).toBe("reauth_required");
    const { data: notes } = await admin.from("notifications").select("kind, payload").eq("recipient_id", athleteId).eq("kind", "reconnect");
    expect(notes?.some((n) => (n.payload as { provider?: string }).provider === "suunto")).toBe(true);
    const jobs = await admin.from("sync_jobs").select("id").eq("athlete_id", athleteId).eq("kind", "suunto_sync").eq("status", "pending");
    expect(jobs.data ?? []).toHaveLength(0);
  });

  it("reconnexion puis déconnexion : les guides TriCoach quittent le compte Suunto, le reste n'est pas touché", async () => {
    expect(await connectSuunto(deps, athleteId, fake.issueCode(user))).toMatchObject({ status: "connected" });
    await run();
    expect(ours().length).toBeGreaterThan(0);
    expect(await disconnectSuunto(deps, athleteId)).toEqual({ removed: true });
    expect(ours()).toHaveLength(0);
    expect(guides().map((g) => g.name)).toEqual(["Pyramide"]);
    expect(await connection()).toBeNull();
    expect(await rows()).toEqual([]);
  });
});
