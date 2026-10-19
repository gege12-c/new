/** Lectures des données d’un athlète. La RLS limite les résultats à ce que l’appelant a le droit de voir. */
import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { ThresholdRow } from "@/lib/thresholds";

export async function getThresholds(supabase: ServerSupabase, athleteId: string) {
  const { data, error } = await supabase
    .from("athlete_thresholds")
    .select("id, sport, metric, value, effective_from, notes")
    .eq("athlete_id", athleteId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, value: Number(row.value) })) as (ThresholdRow & { id: string; notes: string | null })[];
}

export async function getEvents(supabase: ServerSupabase, athleteId: string) {
  const { data, error } = await supabase
    .from("athlete_events")
    .select("id, name, event_date, priority, sport, distance_label, location")
    .eq("athlete_id", athleteId)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getAthleteProfile(supabase: ServerSupabase, athleteId: string) {
  const { data, error } = await supabase
    .from("athlete_profiles")
    .select("main_goal, experience_level, weekly_hours_target, notes")
    .eq("user_id", athleteId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUpcomingSessions(supabase: ServerSupabase, athleteId: string, fromDate: string, limit = 7) {
  const { data, error } = await supabase
    .from("planned_sessions")
    .select("id, scheduled_date, start_time, sport, title, objective, planned_duration_s, planned_distance_m, state")
    .eq("athlete_id", athleteId)
    .gte("scheduled_date", fromDate)
    .neq("state", "cancelled")
    .order("scheduled_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Coachs de l’athlète (relations actives), avec leurs permissions. */
export async function getMyCoaches(supabase: ServerSupabase, athleteId: string) {
  const { data, error } = await supabase
    .from("coach_athlete_links")
    // « * » : les colonnes du partage Strava n'existent qu'après la mise à jour de la base.
    .select("*, coach:profiles!coach_athlete_links_coach_id_fkey(id, display_name)")
    .eq("athlete_id", athleteId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((link) => ({
    id: link.id,
    can_edit_plan: link.can_edit_plan,
    can_view_activities: link.can_view_activities,
    created_at: link.created_at,
    coach: link.coach,
    share_strava: link.share_strava === true,
    strava_shared_at: link.strava_shared_at ?? null,
  }));
}

/** L’athlète partage-t-il ses activités Strava avec au moins un de ses coachs ? (non tant que la base n’est pas à jour) */
export async function sharesStravaWithCoach(supabase: ServerSupabase, athleteId: string): Promise<boolean> {
  const { data, error } = await supabase.from("coach_athlete_links").select("*").eq("athlete_id", athleteId).eq("status", "active");
  if (error) throw error;
  return (data ?? []).some((link) => link.share_strava === true);
}

export const EXPERIENCE_LABELS: Record<string, string> = {
  beginner: "Débutant",
  intermediate: "Intermédiaire",
  advanced: "Confirmé",
  elite: "Élite",
};
