/**
 * Lectures du réalisé à travers la vraie API (PostgREST et RLS) : filtres sur les ressources
 * imbriquées, visibilité Strava limitée à l'athlète, fichiers FIT et retours partagés avec le coach.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getActivityDetail, getRealizedInRange, getSessionRealization } from "@/lib/data/activities";
import type { Database } from "@/lib/supabase/database.types";
import type { ServerSupabase } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Integration-2026";

describe.skipIf(!url || !anonKey || !serviceKey)("lectures du réalisé (API et RLS)", () => {
  const admin = createClient<Database>(url ?? "http://localhost", serviceKey ?? "none", { auth: { persistSession: false, autoRefreshToken: false } });
  const users: string[] = [];
  let athlete: SupabaseClient<Database>;
  let coach: SupabaseClient<Database>;
  let athleteId = "";
  let sessionId = "";
  let stravaActivity = "";
  let fitActivity = "";
  const day = "2026-10-14";

  async function user(name: string, isCoach = false) {
    const email = `realise-${randomUUID().slice(0, 8)}@integration.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: name, timezone: "Europe/Paris" } });
    if (error || !data.user) throw error ?? new Error("compte non créé");
    users.push(data.user.id);
    if (isCoach) await admin.from("profiles").update({ is_coach: true }).eq("id", data.user.id);
    const client = createClient<Database>(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signIn.error) throw signIn.error;
    return { id: data.user.id, client };
  }

  beforeAll(async () => {
    const a = await user("Athlète réalisé");
    const c = await user("Coach réalisé", true);
    athlete = a.client;
    coach = c.client;
    athleteId = a.id;
    await admin.from("coach_athlete_links").insert({ coach_id: c.id, athlete_id: a.id });

    const content = { schemaVersion: 1, segments: [{ id: "s", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 3600 } }] }] };
    const session = await admin
      .from("planned_sessions")
      .insert({ athlete_id: a.id, scheduled_date: day, start_time: "07:00", sport: "run", title: "Footing", content, state: "published", planned_duration_s: 3600 })
      .select("id")
      .single();
    if (session.error) throw session.error;
    sessionId = session.data.id;

    const connection = await admin
      .from("external_connections")
      .insert({ athlete_id: a.id, provider: "strava", external_athlete_id: String(800_000 + Math.floor(Math.random() * 99_999)) })
      .select("id")
      .single();
    if (connection.error) throw connection.error;
    const now = new Date();
    const strava = await admin
      .from("activities")
      .insert({
        athlete_id: a.id,
        source: "strava",
        external_id: String(Math.floor(Math.random() * 1e12)),
        connection_id: connection.data.id,
        sport: "run",
        start_time: `${day}T05:02:00Z`,
        local_date: day,
        local_start_time: "07:02:00",
        moving_s: 3500,
        elapsed_s: 3600,
        distance_m: 10_000,
        fetched_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 6 * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (strava.error) throw strava.error;
    stravaActivity = strava.data.id;

    // L'athlète importe lui-même un fichier FIT, l'après-midi : sans séance.
    const fit = await athlete
      .from("activities")
      .insert({ source: "fit_upload", external_id: `${"ab".repeat(32)}:0`, sport: "bike", start_time: `${day}T14:00:00Z`, local_date: day, local_start_time: "16:00:00", moving_s: 1800, elapsed_s: 1900 })
      .select("id")
      .single();
    if (fit.error) throw fit.error;
    fitActivity = fit.data.id;

    const declared = await athlete.from("session_completions").insert({ session_id: sessionId, status: "done", rpe: 5, note: "Facile" } as never);
    if (declared.error) throw declared.error;
  });

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("l'athlète voit son activité Strava rattachée, son import FIT et son retour", async () => {
    const realized = await getRealizedInRange(athlete as unknown as ServerSupabase, athleteId, addDays(day, -1), addDays(day, 1));
    expect(realized.activities.map((a) => a.id).sort()).toEqual([stravaActivity, fitActivity].sort());
    expect(realized.matches).toMatchObject([{ session_id: sessionId, activity_id: stravaActivity, status: "auto" }]);
    expect(realized.matches[0].activity).toMatchObject({ source: "strava", moving_s: 3500, distance_m: 10_000 });
    expect(realized.completions).toMatchObject([{ session_id: sessionId, status: "done", rpe: 5 }]);
    // Hors période : rien.
    const before = await getRealizedInRange(athlete as unknown as ServerSupabase, athleteId, "2026-09-01", "2026-09-30");
    expect(before).toEqual({ activities: [], matches: [], completions: [] });
  });

  it("le coach voit le fichier FIT et le retour, jamais l'activité Strava", async () => {
    const realized = await getRealizedInRange(coach as unknown as ServerSupabase, [athleteId], addDays(day, -1), addDays(day, 1));
    expect(realized.activities.map((a) => a.id)).toEqual([fitActivity]);
    expect(realized.matches).toEqual([]);
    expect(realized.completions).toMatchObject([{ session_id: sessionId, status: "done", note: "Facile" }]);

    const detail = await getSessionRealization(coach as unknown as ServerSupabase, { id: sessionId, athlete_id: athleteId, scheduled_date: day });
    expect(detail?.attached).toEqual([]);
    expect(detail?.candidates.map((a) => a.id)).toEqual([fitActivity]);
    expect(await getActivityDetail(coach as unknown as ServerSupabase, stravaActivity)).toBeNull();
  });

  it("le panneau d'activité liste ses séances possibles et ses liens", async () => {
    const detail = await getActivityDetail(athlete as unknown as ServerSupabase, stravaActivity);
    expect(detail?.links).toMatchObject([{ session_id: sessionId, status: "auto", title: "Footing" }]);
    expect(detail?.candidates.map((c) => c.id)).toEqual([sessionId]);
    const own = await getSessionRealization(athlete as unknown as ServerSupabase, { id: sessionId, athlete_id: athleteId, scheduled_date: day });
    expect(own?.attached.map((a) => a.id)).toEqual([stravaActivity]);
    expect(own?.candidates).toMatchObject([{ id: fitActivity, attachedElsewhere: false }]);
    expect(own?.completion?.status).toBe("done");
  });
});
