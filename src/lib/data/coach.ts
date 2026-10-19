/** Lectures de l’espace coach. */
import "server-only";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { nowIso } from "@/lib/time";

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
    // « * » : les colonnes du partage Strava n'existent qu'après la mise à jour de la base.
    .select("*")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, can_edit_plan: data.can_edit_plan, can_view_activities: data.can_view_activities, created_at: data.created_at, share_strava: data.share_strava === true } : null;
}

/** Invitations encore utilisables : ni acceptées, ni annulées, ni expirées. */
export async function getPendingInvitations(supabase: ServerSupabase, coachId: string) {
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, created_at, expires_at")
    .eq("coach_id", coachId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", await nowIso())
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

export interface DashboardSession {
  id: string;
  athlete_id: string;
  scheduled_date: string;
  start_time: string | null;
  sport: string;
  title: string;
  state: string;
  planned_duration_s: number | null;
  planned_distance_m: number | null;
}

/** Séances des deux semaines à venir et derniers commentaires, pour tous les athlètes du coach. */
export async function getCoachDashboard(supabase: ServerSupabase, athleteIds: string[], from: string, to: string) {
  if (athleteIds.length === 0) return { sessions: [] as DashboardSession[], comments: [] };
  const [sessions, comments] = await Promise.all([
    supabase
      .from("planned_sessions")
      .select("id, athlete_id, scheduled_date, start_time, sport, title, state, planned_duration_s, planned_distance_m")
      .in("athlete_id", athleteIds)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("scheduled_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: false }),
    supabase
      .from("session_comments")
      .select("id, athlete_id, session_id, body, visibility, created_at, author:profiles!session_comments_author_id_fkey(display_name)")
      .in("athlete_id", athleteIds)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (sessions.error) throw sessions.error;
  if (comments.error) throw comments.error;
  return {
    sessions: (sessions.data ?? []).map((s) => ({ ...s, planned_distance_m: s.planned_distance_m === null ? null : Number(s.planned_distance_m) })),
    comments: (comments.data ?? []).map((c) => ({
      ...c,
      author_name: (c.author as { display_name: string } | null)?.display_name ?? "Compte supprimé",
    })),
  };
}

export interface SyncStatus {
  athlete_id: string;
  provider: string;
  status: "active" | "reauth_required";
  last_sync_at: string | null;
  last_error: string | null;
}

/** État des connexions (Strava) des athlètes : statut seulement, jamais leurs données. */
export async function getSyncStatuses(supabase: ServerSupabase, athleteIds: string[]): Promise<SyncStatus[]> {
  if (athleteIds.length === 0) return [];
  const { data, error } = await supabase.rpc("athlete_sync_status", { p_athletes: athleteIds });
  if (isMissingSchema(error)) return [];
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, status: row.status as SyncStatus["status"] }));
}
