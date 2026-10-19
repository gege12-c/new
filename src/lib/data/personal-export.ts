import "server-only";
import type { Session } from "@/lib/auth/dal";
import { isMissingSchema } from "@/lib/supabase/schema";

/**
 * Export des données personnelles (droit d'accès et à la portabilité) : tout ce qui concerne le
 * compte connecté, lu sous ses propres droits (RLS). Les activités venues de Strava n'y figurent
 * pas : TriCoach ne les garde que quelques jours, sous les règles de Strava, et l'athlète peut les
 * télécharger directement chez Strava.
 */

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };
type Section = { key: string; read: (session: Session) => PromiseLike<QueryResult> };

const SECTIONS: Section[] = [
  {
    key: "account",
    read: ({ supabase, userId }) => supabase.from("profiles").select("id, display_name, timezone, is_coach, created_at, updated_at").eq("id", userId).maybeSingle(),
  },
  { key: "athlete_profile", read: ({ supabase, userId }) => supabase.from("athlete_profiles").select("*").eq("user_id", userId).maybeSingle() },
  { key: "thresholds", read: ({ supabase, userId }) => supabase.from("athlete_thresholds").select("*").eq("athlete_id", userId).order("effective_from") },
  { key: "events", read: ({ supabase, userId }) => supabase.from("athlete_events").select("*").eq("athlete_id", userId).order("event_date") },
  {
    key: "coach_links",
    read: ({ supabase, userId }) => supabase.from("coach_athlete_links").select("*").or(`athlete_id.eq.${userId},coach_id.eq.${userId}`).order("created_at"),
  },
  {
    key: "invitations_sent",
    read: ({ supabase, userId }) =>
      supabase.from("invitations").select("id, email, created_at, expires_at, accepted_at, revoked_at").eq("coach_id", userId).order("created_at"),
  },
  { key: "sessions", read: ({ supabase, userId }) => supabase.from("planned_sessions").select("*").eq("athlete_id", userId).order("scheduled_date") },
  {
    key: "comments",
    read: ({ supabase, userId }) => supabase.from("session_comments").select("*").or(`athlete_id.eq.${userId},author_id.eq.${userId}`).order("created_at"),
  },
  { key: "session_feedback", read: ({ supabase, userId }) => supabase.from("session_completions").select("*").eq("athlete_id", userId).order("created_at") },
  {
    key: "imported_activities",
    read: ({ supabase, userId }) => supabase.from("activities").select("*").eq("athlete_id", userId).eq("source", "fit_upload").order("start_time"),
  },
  { key: "activity_matches", read: ({ supabase, userId }) => supabase.from("session_activity_matches").select("*").eq("athlete_id", userId) },
  { key: "exports", read: ({ supabase, userId }) => supabase.from("workout_exports").select("*").eq("athlete_id", userId).order("created_at") },
  { key: "templates", read: ({ supabase, userId }) => supabase.from("workout_templates").select("*").eq("owner_id", userId).order("created_at") },
  {
    key: "connections",
    read: ({ supabase, userId }) => supabase.from("external_connections").select("id, provider, status, scopes, connected_at, last_sync_at").eq("athlete_id", userId),
  },
  { key: "notifications", read: ({ supabase, userId }) => supabase.from("notifications").select("*").eq("recipient_id", userId).order("created_at") },
  { key: "notification_settings", read: ({ supabase, userId }) => supabase.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle() },
];

export const EXPORT_NOTES = [
  "Instants en UTC (ISO 8601) ; les dates de séance sont des dates locales, sans fuseau.",
  "Les activités reçues de Strava ne sont pas incluses : TriCoach ne les garde que quelques jours ; téléchargez-les directement depuis votre compte Strava.",
  "Les séances que vous avez programmées pour vos athlètes leur appartiennent : elles figurent dans leur propre export.",
  "Le contenu des séances suit le format décrit dans docs/WORKOUT_FORMAT.md du dépôt de TriCoach.",
];

export type PersonalExport = {
  format: "tricoach-personal-data";
  version: 1;
  exported_at: string;
  email: string | null;
  notes: string[];
  /** Rubriques pas encore disponibles sur ce site (base de données à mettre à jour). */
  unavailable: string[];
  data: Record<string, unknown>;
};

export async function buildPersonalExport(session: Session, now = new Date()): Promise<PersonalExport> {
  const results = await Promise.all(SECTIONS.map(async (section) => [section.key, await section.read(session)] as const));
  const data: Record<string, unknown> = {};
  const unavailable: string[] = [];
  for (const [key, { data: rows, error }] of results) {
    if (error) {
      if (!isMissingSchema(error)) throw new Error(`${key}: ${error.message}`);
      unavailable.push(key);
      data[key] = null;
      continue;
    }
    data[key] = rows;
  }
  // Un rapprochement avec une activité Strava est une donnée dérivée de Strava : il reste hors de l'export.
  if (Array.isArray(data.activity_matches)) {
    const imported = new Set(Array.isArray(data.imported_activities) ? data.imported_activities.map((a: { id: string }) => a.id) : []);
    data.activity_matches = data.activity_matches.filter((m: { activity_id: string }) => imported.has(m.activity_id));
  }
  return {
    format: "tricoach-personal-data",
    version: 1,
    exported_at: now.toISOString(),
    email: session.email,
    notes: EXPORT_NOTES,
    unavailable,
    data,
  };
}
