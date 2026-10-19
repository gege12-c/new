/** Données de la courbe de condition physique d'un athlète, lues sous les droits de l'utilisateur (RLS). */
import "server-only";
import { addDays } from "@/lib/planning/dates";
import {
  dailyLoads,
  FITNESS_DAYS,
  fitnessSeries,
  HISTORY_DAYS,
  historyStart,
  PROJECTION_DAYS,
  type FitnessCompletion,
  type FitnessCoverage,
  type FitnessPoint,
  type LoadActivity,
} from "@/lib/stats/fitness";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { getThresholds } from "./athlete";
import { getSessionsInRange } from "./planning";

export interface FitnessData {
  today: string;
  /** Points affichés : 13 semaines passées, puis la prévision. */
  points: FitnessPoint[];
  current: FitnessPoint | null;
  coverage: FitnessCoverage;
  /** Fichiers FIT et retours de séance lisibles (false tant que la base n'est pas à jour). */
  realizedAvailable: boolean;
  /** Jours depuis la première charge réelle comptée (null : aucune). */
  historyDays: number | null;
}

const ACTIVITY_COLUMNS = "id, sport, local_date, moving_s, elapsed_s, avg_power, weighted_power, avg_hr, avg_speed_mps";

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export async function getFitnessData(supabase: ServerSupabase, athleteId: string, today: string): Promise<FitnessData> {
  const start = historyStart(today);
  const horizon = addDays(today, PROJECTION_DAYS);
  const [sessions, thresholdRows, activities, completions, matches] = await Promise.all([
    getSessionsInRange(supabase, athleteId, start, horizon),
    getThresholds(supabase, athleteId),
    supabase.from("activities").select(ACTIVITY_COLUMNS).eq("athlete_id", athleteId).eq("source", "fit_upload").gte("local_date", start).lte("local_date", today).limit(3000),
    supabase.from("session_completions").select("session_id, status, rpe").eq("athlete_id", athleteId).limit(3000),
    supabase
      .from("session_activity_matches")
      .select("session_id, activity_id, activity:activities!inner(source)")
      .eq("athlete_id", athleteId)
      .in("status", ["auto", "confirmed"])
      .eq("activity.source", "fit_upload")
      .limit(3000),
  ]);
  for (const result of [activities, completions, matches]) {
    if (result.error && !isMissingSchema(result.error)) throw result.error;
  }
  const realizedAvailable = !activities.error && !completions.error && !matches.error;

  const { actual, planned, coverage } = dailyLoads({
    today,
    sessions,
    activities: realizedAvailable ? ((activities.data ?? []) as LoadActivity[]) : [],
    matches: new Map(realizedAvailable ? (matches.data ?? []).map((m) => [m.activity_id as string, m.session_id as string]) : []),
    completions: new Map(
      realizedAvailable ? (completions.data ?? []).map((c) => [c.session_id as string, { session_id: c.session_id, status: c.status, rpe: c.rpe } as FitnessCompletion]) : [],
    ),
    thresholdsOn: (date) => toAthleteThresholds(currentThresholds(thresholdRows, date)),
  });

  // La prévision va jusqu'à la dernière séance prévue (une semaine au moins, six au plus).
  const lastPlanned = [...planned.keys()].sort().at(-1);
  const end = lastPlanned && lastPlanned > addDays(today, 7) ? lastPlanned : addDays(today, 7);
  const series = fitnessSeries(actual, planned, start, end > horizon ? horizon : end, today);
  const windowStart = addDays(today, -HISTORY_DAYS);
  const points = series.filter((p) => p.date >= windowStart);
  const firstActual = [...actual.keys()].sort()[0];
  return {
    today,
    points,
    current: series.find((p) => p.date === today) ?? null,
    coverage,
    realizedAvailable,
    historyDays: firstActual ? daysBetween(firstActual, today) : null,
  };
}

/** La condition se construit sur 42 jours : avec moins d'historique, elle est sous-estimée. */
export const BUILDING_DAYS = FITNESS_DAYS;
