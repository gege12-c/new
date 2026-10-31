/** Données de la courbe de condition physique d'un athlète, lues sous les droits de l'utilisateur (RLS). */
import "server-only";
import { addDays } from "@/lib/planning/dates";
import {
  dailyLoads,
  FITNESS_DAYS,
  fitnessSeries,
  historyStart,
  MAX_HISTORY_DAYS,
  medianRestingHr,
  PROJECTION_DAYS,
  PUBLISHED_PLAN,
  RESTING_HR_DAYS,
  simulate,
  weeklyRamp,
  type FitnessCompletion,
  type FitnessCoverage,
  type FitnessModel,
  type FitnessPoint,
  type LoadActivity,
  type LoadItem,
} from "@/lib/stats/fitness";
import { DURABLE_SOURCES } from "@/lib/activities/schema";
import { StoredMetricsSchema } from "@/lib/activities/streams";
import { isMissingSchema, missingColumn } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { thresholdsAsOf, toAthleteThresholds } from "@/lib/thresholds";
import { getEvents, getThresholds } from "./athlete";
import { getSessionsInRange } from "./planning";

export interface FitnessRace {
  id: string;
  name: string;
  date: string;
  priority: string;
}

export interface FitnessData {
  today: string;
  /** Jour par jour, d'un an avant aujourd'hui à la veille : charges réelles comptées. */
  history: FitnessPoint[];
  /** De quoi simuler la suite : état de la veille, charge faite aujourd'hui, séances prévues jusqu'à l'horizon. */
  model: FitnessModel;
  /** Charges comptées de l'historique (détail d'un jour). */
  pastItems: LoadItem[];
  /** Courses de l'année passée à l'horizon. */
  races: FitnessRace[];
  /** Aujourd'hui, et dans 7 jours, avec le plan publié. */
  current: FitnessPoint | null;
  inAWeek: FitnessPoint | null;
  /** Variation de la condition sur les 7 derniers jours. */
  ramp: number | null;
  coverage: FitnessCoverage;
  /** Fichiers FIT et retours de séance lisibles (false tant que la base n'est pas à jour). */
  realizedAvailable: boolean;
  /** Jours depuis la première charge réelle comptée (null : aucune). */
  historyDays: number | null;
}

const ACTIVITY_COLUMNS = "id, name, sport, local_date, start_time, moving_s, elapsed_s, avg_power, weighted_power, avg_hr, avg_speed_mps";

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export async function getFitnessData(supabase: ServerSupabase, athleteId: string, today: string): Promise<FitnessData> {
  const start = historyStart(today);
  const limit = addDays(today, PROJECTION_DAYS);
  const [sessions, thresholdRows, events, activities, completions, matches, curves, wellness, sourceLoads] = await Promise.all([
    getSessionsInRange(supabase, athleteId, start, limit),
    getThresholds(supabase, athleteId),
    getEvents(supabase, athleteId),
    supabase.from("activities").select(ACTIVITY_COLUMNS).eq("athlete_id", athleteId).in("source", [...DURABLE_SOURCES]).is("duplicate_of", null).gte("local_date", start).lte("local_date", today).limit(5000),
    supabase.from("session_completions").select("session_id, status, rpe").eq("athlete_id", athleteId).limit(5000),
    supabase
      .from("session_activity_matches")
      .select("session_id, activity_id, activity:activities!inner(source)")
      .eq("athlete_id", athleteId)
      .in("status", ["auto", "confirmed"])
      .in("activity.source", [...DURABLE_SOURCES])
      .limit(5000),
    // Mesures normalisées des courbes lues (montre, fichiers FIT) : charges plus fidèles que les moyennes.
    supabase
      .from("activity_streams")
      .select("activity_id, metrics, activity:activities!inner(athlete_id, local_date)")
      .eq("activity.athlete_id", athleteId)
      .gte("activity.local_date", start)
      .limit(5000),
    // FC de repos des derniers jours : la charge d'après la FC se calcule alors sur la réserve cardiaque.
    supabase
      .from("wellness_entries")
      .select("resting_hr")
      .eq("athlete_id", athleteId)
      .gte("entry_date", addDays(today, -RESTING_HR_DAYS))
      .lte("entry_date", today)
      .not("resting_hr", "is", null)
      .limit(RESTING_HR_DAYS + 1),
    // Charges calculées par intervals.icu (base à jour) : reprises telles quelles.
    supabase.from("activities").select("id, source_load").eq("athlete_id", athleteId).not("source_load", "is", null).gte("local_date", start).lte("local_date", today).limit(5000),
  ]);
  if (sourceLoads.error && !isMissingSchema(sourceLoads.error) && !missingColumn(sourceLoads.error)) throw sourceLoads.error;
  const loadsFromSource = new Map((sourceLoads.error ? [] : (sourceLoads.data ?? [])).map((row) => [row.id as string, Number(row.source_load)]));
  if (wellness.error && !isMissingSchema(wellness.error)) throw wellness.error;
  const measuredRestingHr = medianRestingHr(wellness.error ? [] : (wellness.data ?? []).map((row) => row.resting_hr));
  // Base sans les courbes ou sans leurs mesures : les moyennes servent, comme avant.
  if (curves.error && !isMissingSchema(curves.error) && String(curves.error.code) !== "42703") throw curves.error;
  const metrics = new Map(
    (curves.error ? [] : (curves.data ?? [])).map((row) => {
      const parsed = StoredMetricsSchema.safeParse(row.metrics);
      return [row.activity_id, parsed.success ? parsed.data : {}] as const;
    }),
  );
  for (const result of [activities, completions, matches]) {
    if (result.error && !isMissingSchema(result.error)) throw result.error;
  }
  const realizedAvailable = !activities.error && !completions.error && !matches.error;

  const { actual, coverage, items } = dailyLoads({
    today,
    sessions,
    activities: realizedAvailable
      ? ((activities.data ?? []) as LoadActivity[]).map((a) => {
          const m = metrics.get(a.id);
          const withSource = { ...a, source_load: loadsFromSource.get(a.id) ?? null };
          return m ? { ...withSource, np: m.np ?? null, ngs: m.ngs ?? null, hr_rms: m.hr_rms ?? null } : withSource;
        })
      : [],
    matches: new Map(realizedAvailable ? (matches.data ?? []).map((m) => [m.activity_id as string, m.session_id as string]) : []),
    completions: new Map(
      realizedAvailable ? (completions.data ?? []).map((c) => [c.session_id as string, { session_id: c.session_id, status: c.status, rpe: c.rpe } as FitnessCompletion]) : [],
    ),
    thresholdsOn: (date) => {
      // Seuils saisis après une activité : leur première valeur sert d'estimation (dit dans l'écran).
      const thresholds = toAthleteThresholds(thresholdsAsOf(thresholdRows, date).current);
      if (!thresholds.general?.restingHrBpm && measuredRestingHr) thresholds.general = { ...thresholds.general, restingHrBpm: measuredRestingHr };
      return thresholds;
    },
    estimatedOn: (date, keys) => {
      const { backdated } = thresholdsAsOf(thresholdRows, date);
      return keys.some((key) => backdated.has(key));
    },
  });

  // Horizon : la dernière séance prévue (brouillons compris) ou la prochaine course, une semaine au moins, six mois au plus.
  const plannedItems = items.filter((i) => i.kind === "planned" && i.date >= today && i.date <= limit);
  const lastPlanned = plannedItems.reduce((last, i) => (i.date > last ? i.date : last), today);
  const nextRace = events.find((e) => e.event_date > today && e.event_date <= limit && e.priority === "A") ?? events.find((e) => e.event_date > today && e.event_date <= limit);
  const candidates = [addDays(today, 7), lastPlanned, nextRace ? addDays(nextRace.event_date, 2) : today].sort();
  const horizon = candidates[candidates.length - 1] > limit ? limit : candidates[candidates.length - 1];

  // Historique : calculé dès le début des données lues, pour que la condition n'y parte pas de zéro.
  const yesterday = addDays(today, -1);
  const series = fitnessSeries(actual, new Map(), start, yesterday, today);
  const last = series[series.length - 1];
  const windowStart = addDays(today, -MAX_HISTORY_DAYS);
  const history = series.filter((p) => p.date >= windowStart);
  const model: FitnessModel = {
    today,
    start: { fitness: last?.fitness ?? 0, fatigue: last?.fatigue ?? 0 },
    todayActual: actual.get(today) ?? 0,
    planned: plannedItems.filter((i) => i.date <= horizon),
    horizon,
  };
  const future = simulate(model, PUBLISHED_PLAN);
  const firstActual = [...actual.keys()].sort()[0];
  return {
    today,
    history,
    model,
    pastItems: items.filter((i) => i.kind !== "planned" && i.date >= windowStart && i.date <= today),
    races: events.filter((e) => e.event_date >= windowStart && e.event_date <= horizon).map((e) => ({ id: e.id, name: e.name, date: e.event_date, priority: e.priority })),
    current: future[0] ?? null,
    inAWeek: future.find((p) => p.date === addDays(today, 7)) ?? null,
    ramp: weeklyRamp([...history, ...future], today),
    coverage,
    realizedAvailable,
    historyDays: firstActual ? daysBetween(firstActual, today) : null,
  };
}

/** La condition se construit sur 42 jours : avec moins d'historique, elle est sous-estimée. */
export const BUILDING_DAYS = FITNESS_DAYS;
