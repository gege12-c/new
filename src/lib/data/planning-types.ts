/** Types partagés de la planification, utilisables côté client comme côté serveur. */
import type { ActivitySource, ActivitySport } from "@/lib/activities/schema";
import type { SessionState } from "@/lib/planning/status";
import type { SessionSport, Workout } from "@/lib/workout/schema";

export interface CalendarSession {
  id: string;
  athlete_id: string;
  scheduled_date: string;
  start_time: string | null;
  sport: SessionSport;
  title: string;
  objective: string | null;
  planned_duration_s: number | null;
  planned_distance_m: number | null;
  state: SessionState;
  version: number;
  created_by: string | null;
  content: Workout;
  /** Modifications en attente de publication (visible des seuls éditeurs). */
  pending: boolean;
  /** Réalisé visible de l’utilisateur (les activités Strava ne le sont que de l’athlète). */
  realization?: SessionRealization;
}

/** Activité réalisée, telle que l’utilisateur peut la voir. */
export interface CalendarActivity {
  id: string;
  athlete_id?: string;
  source: ActivitySource;
  external_id: string;
  sport: ActivitySport;
  sport_detail: string | null;
  name: string | null;
  start_time: string;
  local_date: string;
  local_start_time: string | null;
  elapsed_s: number | null;
  moving_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  weighted_power: number | null;
  avg_speed_mps: number | null;
  trainer: boolean | null;
  device_name: string | null;
  /** Strava : effacement programmé (cache de 6 jours). */
  expires_at: string | null;
}

export type MatchStatus = "auto" | "confirmed" | "proposed" | "rejected";

export interface ActivityMatch {
  id: string;
  session_id: string;
  activity_id: string;
  status: MatchStatus;
  score: number | null;
}

export interface SessionCompletion {
  session_id: string;
  athlete_id: string;
  status: "done" | "partial" | "skipped";
  rpe: number | null;
  note: string | null;
  updated_at: string;
}

export interface SessionRealization {
  /** Activités rattachées (automatiquement ou par décision). */
  attached: CalendarActivity[];
  /** Activités proposées, à confirmer par l’athlète. */
  proposals: CalendarActivity[];
  completion: SessionCompletion | null;
}

export interface CalendarEvent {
  id: string;
  name: string;
  event_date: string;
  priority: string;
  sport: string;
  distance_label: string | null;
  location: string | null;
}

export interface SessionComment {
  id: string;
  body: string;
  visibility: "shared" | "coach_private";
  created_at: string;
  edited_at: string | null;
  author_id: string;
  author_name: string;
}

export interface HistoryEntry {
  id: number;
  occurred_at: string;
  action: "insert" | "update" | "delete";
  actor_name: string;
  fields: string[];
  changes: Record<string, unknown>;
}

export interface TemplateSummary {
  id: string;
  name: string;
  sport: SessionSport;
  objective: string | null;
  description: string | null;
  content: Workout;
  planned_duration_s: number | null;
  tags: string[];
  updated_at: string;
}
