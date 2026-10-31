/** Vue saison : semaines passées et à venir d’un athlète (séances, réalisé durable, compétitions, indisponibilités). */
import "server-only";
import { DURABLE_SOURCES } from "@/lib/activities/schema";
import { getEvents } from "@/lib/data/athlete";
import { getCalendarNotes } from "@/lib/data/notes";
import { getSessionsInRange } from "@/lib/data/planning";
import { addDays, startOfWeek } from "@/lib/planning/dates";
import type { CalendarNote } from "@/lib/planning/notes";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";

export const SEASON_PAST_WEEKS = 8;
export const SEASON_FUTURE_WEEKS = 26;

export interface SeasonData {
  mondays: string[];
  sessions: Awaited<ReturnType<typeof getSessionsInRange>>;
  /** Durée réalisée par semaine (fichiers FIT et montre ; jamais Strava) ; null si non visible. */
  realized: Map<string, number> | null;
  events: Awaited<ReturnType<typeof getEvents>>;
  notes: CalendarNote[];
}

export async function getSeasonData(supabase: ServerSupabase, athleteId: string, today: string, options: { canSeeActivities: boolean }): Promise<SeasonData> {
  const first = addDays(startOfWeek(today), -7 * SEASON_PAST_WEEKS);
  const mondays = Array.from({ length: SEASON_PAST_WEEKS + SEASON_FUTURE_WEEKS }, (_, i) => addDays(first, 7 * i));
  const last = addDays(mondays[mondays.length - 1], 6);
  const [sessions, events, notes, activities] = await Promise.all([
    getSessionsInRange(supabase, athleteId, first, last),
    getEvents(supabase, athleteId),
    getCalendarNotes(supabase, athleteId, first, last),
    options.canSeeActivities
      ? supabase
          .from("activities")
          .select("local_date, moving_s, elapsed_s")
          .eq("athlete_id", athleteId)
          .in("source", [...DURABLE_SOURCES])
          .is("duplicate_of", null)
          .gte("local_date", first)
          .lte("local_date", today)
      : Promise.resolve(null),
  ]);
  let realized: Map<string, number> | null = null;
  if (activities && !activities.error) {
    realized = new Map();
    for (const a of activities.data ?? []) {
      const monday = startOfWeek(a.local_date);
      realized.set(monday, (realized.get(monday) ?? 0) + (a.moving_s ?? a.elapsed_s ?? 0));
    }
  } else if (activities?.error && !isMissingSchema(activities.error)) {
    throw activities.error;
  }
  return { mondays, sessions, realized, events: events.filter((e) => e.event_date >= first && e.event_date <= last), notes };
}
