/**
 * Lectures des activités réalisées, sous les droits de l’utilisateur : la RLS ne montre les
 * activités Strava qu’à l’athlète lui-même (et jusqu’à leur expiration), jamais à ses coachs.
 */
import "server-only";
import { addDays } from "@/lib/planning/dates";
import type { RealizedRange } from "@/lib/activities/realization";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { ActivityMatch, CalendarActivity, MatchStatus, SessionCompletion } from "./planning-types";

export const ACTIVITY_COLUMNS =
  "id, source, external_id, sport, sport_detail, name, start_time, local_date, local_start_time, elapsed_s, moving_s, distance_m, elevation_gain_m, avg_hr, max_hr, avg_power, weighted_power, avg_speed_mps, trainer, device_name, expires_at";

type Numeric = number | string | null;
type ActivityRow = Omit<CalendarActivity, "source" | "sport" | "distance_m" | "elevation_gain_m" | "avg_speed_mps"> & {
  source: string;
  sport: string;
  distance_m: Numeric;
  elevation_gain_m: Numeric;
  avg_speed_mps: Numeric;
};

const num = (value: Numeric) => (value === null ? null : Number(value));

export function toCalendarActivity(row: ActivityRow): CalendarActivity {
  return {
    ...row,
    source: row.source as CalendarActivity["source"],
    sport: row.sport as CalendarActivity["sport"],
    distance_m: num(row.distance_m),
    elevation_gain_m: num(row.elevation_gain_m),
    avg_speed_mps: num(row.avg_speed_mps),
  };
}

const LIVE_STATUSES: MatchStatus[] = ["auto", "confirmed", "proposed"];

/** Réalisation visible d’un ou plusieurs athlètes pour les séances et les activités de la période. */
export async function getRealizedInRange(supabase: ServerSupabase, athlete: string | string[], from: string, to: string): Promise<RealizedRange> {
  const ids = Array.isArray(athlete) ? athlete : [athlete];
  if (!ids.length) return { activities: [], matches: [], completions: [] };
  const [activities, matches, completions] = await Promise.all([
    supabase
      .from("activities")
      .select(`${ACTIVITY_COLUMNS}, athlete_id, links:session_activity_matches(session_id, status)`)
      .in("athlete_id", ids)
      .gte("local_date", from)
      .lte("local_date", to)
      .order("start_time", { ascending: true }),
    supabase
      .from("session_activity_matches")
      .select(`id, session_id, activity_id, status, score, session:planned_sessions!inner(scheduled_date), activity:activities!inner(${ACTIVITY_COLUMNS}, athlete_id)`)
      .in("athlete_id", ids)
      .in("status", LIVE_STATUSES)
      .gte("session.scheduled_date", from)
      .lte("session.scheduled_date", to),
    supabase
      .from("session_completions")
      .select("session_id, athlete_id, status, rpe, note, updated_at, session:planned_sessions!inner(scheduled_date)")
      .in("athlete_id", ids)
      .gte("session.scheduled_date", from)
      .lte("session.scheduled_date", to),
  ]);
  if ([activities.error, matches.error, completions.error].some(isMissingSchema)) {
    return { unavailable: true, activities: [], matches: [], completions: [] };
  }
  if (activities.error) throw activities.error;
  if (matches.error) throw matches.error;
  if (completions.error) throw completions.error;

  return {
    activities: (activities.data ?? []).map((row) => {
      const { links, ...rest } = row as unknown as ActivityRow & { links: { session_id: string; status: string }[] };
      return {
        ...toCalendarActivity(rest),
        links: links.map((l) => ({ session_id: l.session_id, status: l.status as MatchStatus })),
      };
    }),
    matches: (matches.data ?? []).map((row) => {
      const m = row as unknown as Omit<ActivityMatch, "status" | "score"> & { status: string; score: Numeric; activity: ActivityRow };
      return {
        id: m.id,
        session_id: m.session_id,
        activity_id: m.activity_id,
        status: m.status as MatchStatus,
        score: num(m.score),
        activity: toCalendarActivity(m.activity),
      };
    }),
    completions: (completions.data ?? []).map((c) => ({
      session_id: c.session_id,
      athlete_id: c.athlete_id,
      status: c.status as SessionCompletion["status"],
      rpe: c.rpe,
      note: c.note,
      updated_at: c.updated_at,
    })),
  };
}

export interface SessionRealizationDetail {
  attached: (CalendarActivity & { match: Pick<ActivityMatch, "id" | "status" | "score"> })[];
  proposals: (CalendarActivity & { match: Pick<ActivityMatch, "id" | "status" | "score"> })[];
  /** Activités des jours voisins (veille, jour même, lendemain) que l’on peut rattacher à la main. */
  candidates: (CalendarActivity & { attachedElsewhere: boolean })[];
  completion: SessionCompletion | null;
}

/** Réalisation d’une séance, pour son panneau de détail (null si la base n’a pas encore ces tables). */
export async function getSessionRealization(
  supabase: ServerSupabase,
  session: { id: string; athlete_id: string; scheduled_date: string },
): Promise<SessionRealizationDetail | null> {
  const [matches, nearby, completion] = await Promise.all([
    supabase
      .from("session_activity_matches")
      .select(`id, status, score, activity:activities!inner(${ACTIVITY_COLUMNS})`)
      .eq("session_id", session.id)
      .in("status", LIVE_STATUSES),
    supabase
      .from("activities")
      .select(`${ACTIVITY_COLUMNS}, links:session_activity_matches(session_id, status)`)
      .eq("athlete_id", session.athlete_id)
      .gte("local_date", addDays(session.scheduled_date, -1))
      .lte("local_date", addDays(session.scheduled_date, 1))
      .order("start_time", { ascending: true }),
    supabase.from("session_completions").select("session_id, athlete_id, status, rpe, note, updated_at").eq("session_id", session.id).maybeSingle(),
  ]);
  if ([matches.error, nearby.error, completion.error].some(isMissingSchema)) return null;
  if (matches.error) throw matches.error;
  if (nearby.error) throw nearby.error;
  if (completion.error) throw completion.error;

  const linked = (matches.data ?? []).map((row) => {
    const m = row as unknown as { id: string; status: string; score: Numeric; activity: ActivityRow };
    return { ...toCalendarActivity(m.activity), match: { id: m.id, status: m.status as MatchStatus, score: num(m.score) } };
  });
  const shown = new Set(linked.map((a) => a.id));
  const byStart = (a: CalendarActivity, b: CalendarActivity) => a.start_time.localeCompare(b.start_time);
  return {
    attached: linked.filter((a) => a.match.status !== "proposed").sort(byStart),
    proposals: linked.filter((a) => a.match.status === "proposed").sort(byStart),
    candidates: (nearby.data ?? [])
      .map((row) => {
        const { links, ...rest } = row as unknown as ActivityRow & { links: { session_id: string; status: string }[] };
        return { activity: toCalendarActivity(rest), links };
      })
      // Déjà rattachée ailleurs : on la propose quand même (le rattachement la déplacera), sauf si elle est ici.
      .filter(({ activity }) => !shown.has(activity.id))
      .map(({ activity, links }) => ({
        ...activity,
        attachedElsewhere: links.some((l) => l.session_id !== session.id && (l.status === "auto" || l.status === "confirmed")),
      })),
    completion: completion.data
      ? {
          session_id: completion.data.session_id,
          athlete_id: completion.data.athlete_id,
          status: completion.data.status as SessionCompletion["status"],
          rpe: completion.data.rpe,
          note: completion.data.note,
          updated_at: completion.data.updated_at,
        }
      : null,
  };
}

export interface ActivityDetail extends CalendarActivity {
  links: (Pick<ActivityMatch, "session_id" | "status"> & { title: string; scheduled_date: string; sport: string })[];
  /** Séances visibles des jours voisins, auxquelles l’activité peut être rattachée. */
  candidates: { id: string; title: string; scheduled_date: string; sport: string; start_time: string | null; state: string }[];
}

/** Une activité et ses liens, pour son panneau (activité non rattachée ouverte depuis le calendrier). */
export async function getActivityDetail(supabase: ServerSupabase, activityId: string): Promise<ActivityDetail | null> {
  const { data, error } = await supabase
    .from("activities")
    .select(`${ACTIVITY_COLUMNS}, athlete_id, links:session_activity_matches(session_id, status, session:planned_sessions(title, scheduled_date, sport))`)
    .eq("id", activityId)
    .maybeSingle();
  if (isMissingSchema(error)) return null;
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as ActivityRow & {
    athlete_id: string;
    links: { session_id: string; status: string; session: { title: string; scheduled_date: string; sport: string } | null }[];
  };
  const { links, athlete_id, ...rest } = row;
  const activity = toCalendarActivity(rest);
  const sessions = await supabase
    .from("planned_sessions")
    .select("id, title, scheduled_date, sport, start_time, state")
    .eq("athlete_id", athlete_id)
    .neq("state", "cancelled")
    .gte("scheduled_date", addDays(activity.local_date, -1))
    .lte("scheduled_date", addDays(activity.local_date, 1))
    .order("scheduled_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });
  if (sessions.error) throw sessions.error;
  return {
    ...activity,
    links: links
      .filter((l) => l.session && l.status !== "rejected")
      .map((l) => ({ session_id: l.session_id, status: l.status as MatchStatus, title: l.session!.title, scheduled_date: l.session!.scheduled_date, sport: l.session!.sport })),
    candidates: sessions.data ?? [],
  };
}
