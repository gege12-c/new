/** Notes de calendrier, lues sous les droits de l’utilisateur (l’athlète et ses coachs actifs). */
import "server-only";
import type { CalendarNote } from "@/lib/planning/notes";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";

const COLUMNS = "id, athlete_id, kind, start_date, end_date, title, note, created_by";

/** Notes qui touchent la période [from, to] ; vide tant que la base n’a pas la table. */
export async function getCalendarNotes(supabase: ServerSupabase, athleteId: string, from: string, to: string): Promise<CalendarNote[]> {
  const { data, error } = await supabase
    .from("calendar_notes")
    .select(COLUMNS)
    .eq("athlete_id", athleteId)
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: true });
  if (isMissingSchema(error)) return [];
  if (error) throw error;
  return (data ?? []) as CalendarNote[];
}

/** Une note, pour son panneau (null si elle n’existe plus ou n’est pas accessible). */
export async function getCalendarNote(supabase: ServerSupabase, noteId: string): Promise<CalendarNote | null> {
  const { data, error } = await supabase.from("calendar_notes").select(COLUMNS).eq("id", noteId).maybeSingle();
  if (isMissingSchema(error)) return null;
  if (error) throw error;
  return (data as CalendarNote | null) ?? null;
}

/** Indisponibilités en cours ou à venir de plusieurs athlètes (tableau de bord du coach). */
export async function getUpcomingUnavailability(supabase: ServerSupabase, athleteIds: string[], today: string, horizon: string): Promise<CalendarNote[]> {
  if (!athleteIds.length) return [];
  const { data, error } = await supabase
    .from("calendar_notes")
    .select(COLUMNS)
    .in("athlete_id", athleteIds)
    .neq("kind", "note")
    .gte("end_date", today)
    .lte("start_date", horizon)
    .order("start_date", { ascending: true });
  if (isMissingSchema(error)) return [];
  if (error) throw error;
  return (data ?? []) as CalendarNote[];
}
