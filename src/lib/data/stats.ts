/** Données des statistiques d'un athlète, lues sous les droits de l'utilisateur (RLS). */
import "server-only";
import { addDays } from "@/lib/planning/dates";
import { adherence, fitRecords, intensityDistribution, lastWeeks, thresholdSeries, weeklyVolumes, type Adherence, type IntensityDistribution, type RecordEntry, type StatActivity, type ThresholdSeries, type WeekVolume } from "@/lib/stats/stats";
import { DURABLE_SOURCES } from "@/lib/activities/schema";
import { estimateFtp, estimateThresholdPace, type FtpEstimate, type PaceEstimate } from "@/lib/stats/estimates";
import { paceCurve, powerCurve, type PaceCurve, type PowerCurve } from "@/lib/stats/power";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { getDetailsProgress, type DetailsProgress } from "./activities";
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
  /** Meilleures puissances par période ; null tant que la base n'a pas les courbes d'activité. */
  power: PowerCurve | null;
  /** Meilleurs temps par distance, en course et en natation ; null sans les courbes d'activité. */
  run: PaceCurve | null;
  swim: PaceCurve | null;
  /** Seuils estimés d'après les records des 3 derniers mois, et les seuils en vigueur pour comparer. */
  estimates: { ftp: FtpEstimate | null; pace: PaceEstimate | null; currentFtp: number | null; currentPace: number | null };
  /** Lecture des détails des activités reçues d'intervals.icu (courbes) : où elle en est. */
  details: DetailsProgress | null;
  athleteId: string;
}

const ACTIVITY_COLUMNS = "sport, local_date, moving_s, elapsed_s, distance_m, avg_power, avg_speed_mps";

export async function getStatsData(supabase: ServerSupabase, athleteId: string, today: string): Promise<StatsData> {
  const weeks = lastWeeks(today, VOLUME_WEEKS);
  const from = weeks[0];
  const to = addDays(weeks[weeks.length - 1], 6);
  const intensityFrom = addDays(weeks[weeks.length - INTENSITY_WEEKS], 0);
  const adherenceFrom = weeks[weeks.length - ADHERENCE_WEEKS];

  const [sessions, thresholdRows, recent, all, fitness, curves, details] = await Promise.all([
    getSessionsInRange(supabase, athleteId, from, to),
    getThresholds(supabase, athleteId),
    supabase.from("activities").select(ACTIVITY_COLUMNS).eq("athlete_id", athleteId).in("source", [...DURABLE_SOURCES]).is("duplicate_of", null).gte("local_date", from).lte("local_date", to),
    supabase.from("activities").select(ACTIVITY_COLUMNS).eq("athlete_id", athleteId).in("source", [...DURABLE_SOURCES]).is("duplicate_of", null).order("local_date", { ascending: false }).limit(2000),
    getFitnessData(supabase, athleteId, today),
    // Courbes lues (montre, fichiers FIT) des 12 derniers mois : puissance à vélo, temps par distance en course et en natation.
    supabase
      .from("activity_streams")
      .select("bests, metrics, activity:activities!inner(id, local_date, sport, duplicate_of, athlete_id)")
      .eq("activity.athlete_id", athleteId)
      .in("activity.sport", ["bike", "run", "swim"])
      .is("activity.duplicate_of", null)
      .gte("activity.local_date", addDays(today, -365))
      .limit(2000),
    getDetailsProgress(supabase, athleteId, today),
  ]);
  if (curves.error && !isMissingSchema(curves.error)) throw curves.error;
  const curveRows = (curves.data ?? []).flatMap((row) =>
    row.activity ? [{ activityId: row.activity.id, date: row.activity.local_date, sport: row.activity.sport, bests: row.bests, pace: (row.metrics as { pace?: unknown } | null)?.pace }] : [],
  );
  const power = curves.error ? null : powerCurve(curveRows.filter((row) => row.sport === "bike"), today);
  const run = curves.error ? null : paceCurve(curveRows, "run", today);
  const swim = curves.error ? null : paceCurve(curveRows, "swim", today);
  const now = currentThresholds(thresholdRows, today);
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
            .in("activity.source", [...DURABLE_SOURCES]),
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
    power,
    run,
    swim,
    estimates: {
      ftp: power ? estimateFtp(power) : null,
      pace: run ? estimateThresholdPace(run) : null,
      currentFtp: now.has("bike.ftp_w") ? Number(now.get("bike.ftp_w")!.value) : null,
      currentPace: now.has("run.threshold_pace_s_per_km") ? Number(now.get("run.threshold_pace_s_per_km")!.value) : null,
    },
    details,
    athleteId,
  };
}
