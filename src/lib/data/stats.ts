/** Données des statistiques d'un athlète, lues sous les droits de l'utilisateur (RLS). */
import "server-only";
import { addDays } from "@/lib/planning/dates";
import { adherence, fitRecords, intensityDistribution, lastWeeks, thresholdSeries, weeklyVolumes, type Adherence, type IntensityDistribution, type RecordEntry, type StatActivity, type ThresholdSeries, type WeekVolume } from "@/lib/stats/stats";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { getThresholds } from "./athlete";
import { getFitnessData, type FitnessData } from "./fitness";
import { getSessionsInRange } from "./planning";

export const VOLUME_WEEKS = 12;
export const ADHERENCE_WEEKS = 8;
export const INTENSITY_WEEKS = 4;
export const THRESHOLD_KEYS = ["bike.ftp_w", "run.threshold_pace_s_per_km", "swim.css_s_per_100m", "bike.lthr_bpm", "run.lthr_bpm"];

export interface StatsData {
  weeks: string[];
  volumes: WeekVolume[];
  /** Fichiers FIT lisibles : false tant que la base n'a pas les tables de la phase 3. */
  activitiesAvailable: boolean;
  fitCount: number;
  intensity: IntensityDistribution;
  intensityFrom: string;
  intensityTo: string;
  adherence: Adherence | null;
  adherenceFrom: string;
  thresholds: ThresholdSeries[];
  records: RecordEntry[];
  fitness: FitnessData;
}

const ACTIVITY_COLUMNS = "sport, local_date, moving_s, elapsed_s, distance_m, avg_power, avg_speed_mps";

export async function getStatsData(supabase: ServerSupabase, athleteId: string, today: string): Promise<StatsData> {
  const weeks = lastWeeks(today, VOLUME_WEEKS);
  const from = weeks[0];
  const to = addDays(weeks[weeks.length - 1], 6);
  const intensityFrom = addDays(weeks[weeks.length - INTENSITY_WEEKS], 0);
  const adherenceFrom = weeks[weeks.length - ADHERENCE_WEEKS];

  const [sessions, thresholdRows, recent, all, fitness] = await Promise.all([
    getSessionsInRange(supabase, athleteId, from, to),
    getThresholds(supabase, athleteId),
    supabase.from("activities").select(ACTIVITY_COLUMNS).eq("athlete_id", athleteId).eq("source", "fit_upload").gte("local_date", from).lte("local_date", to),
    supabase.from("activities").select(ACTIVITY_COLUMNS).eq("athlete_id", athleteId).eq("source", "fit_upload").order("local_date", { ascending: false }).limit(2000),
    getFitnessData(supabase, athleteId, today),
  ]);
  const activitiesAvailable = !recent.error;
  if (recent.error && !isMissingSchema(recent.error)) throw recent.error;
  if (all.error && !isMissingSchema(all.error)) throw all.error;
  const recentActivities = (recent.data ?? []) as StatActivity[];
  const allActivities = (all.data ?? []) as StatActivity[];

  const thresholdsOn = (date: string) => toAthleteThresholds(currentThresholds(thresholdRows, date));

  // Suivi des séances passées : retours de l'athlète et fichiers FIT rattachés (jamais Strava).
  const pastIds = sessions.filter((s) => s.state === "published" && s.scheduled_date >= adherenceFrom && s.scheduled_date < today).map((s) => s.id);
  let adherenceResult: Adherence | null = null;
  if (activitiesAvailable) {
    const [completions, matches] = pastIds.length
      ? await Promise.all([
          supabase.from("session_completions").select("session_id, status").in("session_id", pastIds),
          supabase
            .from("session_activity_matches")
            .select("session_id, activity:activities!inner(source)")
            .in("session_id", pastIds)
            .in("status", ["auto", "confirmed"])
            .eq("activity.source", "fit_upload"),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (completions.error && !isMissingSchema(completions.error)) throw completions.error;
    if (matches.error && !isMissingSchema(matches.error)) throw matches.error;
    if (!completions.error && !matches.error) {
      const declared = new Map((completions.data ?? []).map((c) => [c.session_id as string, c.status as "done" | "partial" | "skipped"]));
      const fit = new Set((matches.data ?? []).map((m) => m.session_id as string));
      adherenceResult = adherence(sessions, declared, fit, adherenceFrom, today);
    }
  }

  return {
    weeks,
    volumes: weeklyVolumes(weeks, sessions, recentActivities, thresholdsOn),
    activitiesAvailable,
    fitCount: allActivities.length,
    intensity: intensityDistribution(sessions, intensityFrom, to, thresholdsOn),
    intensityFrom,
    intensityTo: to,
    adherence: adherenceResult,
    adherenceFrom,
    thresholds: thresholdSeries(thresholdRows, THRESHOLD_KEYS),
    records: fitRecords(allActivities),
    fitness,
  };
}
