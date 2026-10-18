/** Types partagés de la planification, utilisables côté client comme côté serveur. */
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
