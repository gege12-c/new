/** Lectures de l'espace coach. */
import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

/** Athlètes suivis par le coach (relations actives). */
export async function getCoachedAthletes(supabase: ServerSupabase, coachId: string) {
  const { data, error } = await supabase
    .from("coach_athlete_links")
    .select("id, athlete_id, can_edit_plan, can_view_activities, created_at, athlete:profiles!coach_athlete_links_athlete_id_fkey(id, display_name, timezone)")
    .eq("coach_id", coachId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Relation active entre le coach et un athlète donné, ou null. */
export async function getCoachLink(supabase: ServerSupabase, coachId: string, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athlete_links")
    .select("id, can_edit_plan, can_view_activities, created_at")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Invitations encore utilisables : ni acceptées, ni annulées, ni expirées. */
export async function getPendingInvitations(supabase: ServerSupabase, coachId: string) {
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, created_at, expires_at")
    .eq("coach_id", coachId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

/** Données de synthèse pour plusieurs athlètes à la fois (une requête par table). */
export async function getAthletesOverview(supabase: ServerSupabase, athleteIds: string[], today: string) {
  if (athleteIds.length === 0) return { profiles: [], events: [], thresholds: [] };
  const [profiles, events, thresholds] = await Promise.all([
    supabase.from("athlete_profiles").select("user_id, main_goal, weekly_hours_target").in("user_id", athleteIds),
    supabase
      .from("athlete_events")
      .select("athlete_id, name, event_date, priority")
      .in("athlete_id", athleteIds)
      .gte("event_date", today)
      .order("event_date", { ascending: true }),
    supabase.from("athlete_thresholds").select("athlete_id, sport, metric, value, effective_from").in("athlete_id", athleteIds),
  ]);
  for (const result of [profiles, events, thresholds]) if (result.error) throw result.error;
  return {
    profiles: profiles.data ?? [],
    events: events.data ?? [],
    thresholds: (thresholds.data ?? []).map((t) => ({ ...t, value: Number(t.value) })),
  };
}
