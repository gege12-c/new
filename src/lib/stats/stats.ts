/**
 * Statistiques d'entraînement, calculées uniquement sur des données que TriCoach a le droit
 * d'agréger : séances prévues, seuils de l'athlète, retours de séance et fichiers FIT importés.
 * Les activités Strava n'y entrent jamais (accord API Strava, §5.4 : pas d'agrégation ni
 * d'analyse, même de données dérivées). Une statistique sans données suffisantes n'est pas
 * calculée : le résultat dit ce qui manque.
 */
import { computeTotals, intensityPercent, stepQuantities } from "@/lib/workout/compute";
import type { SegmentSport, Workout, WorkoutNode } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { addDays, startOfWeek } from "@/lib/planning/dates";

/** Ordre d'empilement des disciplines : validé pour qu'aucune paire voisine ne se confonde. */
export const STAT_SPORTS = ["swim", "bike", "strength", "run", "other"] as const satisfies readonly SegmentSport[];
export type StatSport = (typeof STAT_SPORTS)[number];

export interface StatSession {
  id: string;
  scheduled_date: string;
  state: string;
  sport: string;
  planned_duration_s: number | null;
  content: Workout;
}

export interface StatActivity {
  sport: string;
  local_date: string;
  moving_s: number | null;
  elapsed_s: number | null;
  distance_m: number | null;
  avg_power: number | null;
  avg_speed_mps: number | null;
}

export interface WeekVolume {
  week: string;
  planned: Record<StatSport, number>;
  plannedTotal: number;
  /** Séances publiées dont une partie de la durée n'est pas calculable. */
  incomplete: number;
  realized: Record<StatSport, number>;
  realizedTotal: number;
}

const emptyBySport = (): Record<StatSport, number> => ({ swim: 0, bike: 0, strength: 0, run: 0, other: 0 });

/** Les `count` derniers lundis jusqu'à la semaine de `today` incluse, du plus ancien au plus récent. */
export function lastWeeks(today: string, count: number): string[] {
  const current = startOfWeek(today);
  return Array.from({ length: count }, (_, i) => addDays(current, (i - count + 1) * 7));
}

const isCounted = (s: StatSession) => s.state === "published";

/** Volume prévu (séances publiées) et réalisé (fichiers FIT) par semaine et par discipline, en secondes. */
/** Seuils de l'athlète en vigueur à une date (les estimations de durée en dépendent). */
export type ThresholdsOn = (date: string) => AthleteThresholds | undefined;

export function weeklyVolumes(weeks: string[], sessions: StatSession[], activities: StatActivity[], thresholdsOn?: ThresholdsOn): WeekVolume[] {
  const byWeek = new Map(weeks.map((week) => [week, { week, planned: emptyBySport(), plannedTotal: 0, incomplete: 0, realized: emptyBySport(), realizedTotal: 0 } as WeekVolume]));
  for (const session of sessions) {
    const entry = byWeek.get(startOfWeek(session.scheduled_date));
    if (!entry || !isCounted(session)) continue;
    const totals = computeTotals(session.content, thresholdsOn?.(session.scheduled_date));
    if (totals.duration.status === "partial" || totals.duration.status === "unknown") entry.incomplete += 1;
    for (const [sport, value] of Object.entries(totals.bySport)) {
      const key = (STAT_SPORTS as readonly string[]).includes(sport) ? (sport as StatSport) : "other";
      entry.planned[key] += value?.durationSeconds ?? 0;
      entry.plannedTotal += value?.durationSeconds ?? 0;
    }
  }
  for (const activity of activities) {
    const entry = byWeek.get(startOfWeek(activity.local_date));
    const seconds = activity.moving_s ?? activity.elapsed_s;
    if (!entry || !seconds) continue;
    const key = (STAT_SPORTS as readonly string[]).includes(activity.sport) ? (activity.sport as StatSport) : "other";
    entry.realized[key] += seconds;
    entry.realizedTotal += seconds;
  }
  return weeks.map((week) => byWeek.get(week)!);
}

/** Bandes d'intensité (% du seuil), alignées sur les couleurs de zones de l'aperçu de séance. */
export const INTENSITY_BANDS = [
  { key: "z1", label: "Récupération", range: "moins de 56 %", max: 56 },
  { key: "z2", label: "Endurance", range: "56 à 75 %", max: 76 },
  { key: "z3", label: "Tempo", range: "76 à 90 %", max: 91 },
  { key: "z4", label: "Seuil", range: "91 à 105 %", max: 106 },
  { key: "z5", label: "VO2max", range: "106 à 120 %", max: 121 },
  { key: "z6", label: "Anaérobie", range: "plus de 120 %", max: Infinity },
] as const;
export type BandKey = (typeof INTENSITY_BANDS)[number]["key"];

export function bandOf(percent: number): BandKey {
  return INTENSITY_BANDS.find((band) => percent < band.max)!.key;
}

export interface IntensityDistribution {
  seconds: Record<BandKey, number>;
  classified: number;
  /** Temps prévu sans intensité exprimable (aucune cible, ou seuil manquant). */
  unclassified: number;
  sessions: number;
}

/** Répartition du temps prévu par bande d'intensité, sur les séances publiées de la période. */
export function intensityDistribution(sessions: StatSession[], from: string, to: string, thresholdsOn?: ThresholdsOn): IntensityDistribution {
  const seconds = Object.fromEntries(INTENSITY_BANDS.map((b) => [b.key, 0])) as Record<BandKey, number>;
  let unclassified = 0;
  let count = 0;
  const walk = (nodes: WorkoutNode[], sport: SegmentSport, times: number, thresholds?: AthleteThresholds) => {
    for (const node of nodes) {
      if (node.kind === "repeat") {
        walk(node.steps, sport, times * node.count, thresholds);
        continue;
      }
      const duration = stepQuantities(node, sport, thresholds).duration.value;
      if (!duration) continue;
      const percent = intensityPercent(node, sport, thresholds);
      if (percent === null) unclassified += duration * times;
      else seconds[bandOf(percent)] += duration * times;
    }
  };
  for (const session of sessions) {
    if (!isCounted(session) || session.scheduled_date < from || session.scheduled_date > to) continue;
    count += 1;
    const thresholds = thresholdsOn?.(session.scheduled_date);
    for (const segment of session.content.segments) walk(segment.steps, segment.sport, 1, thresholds);
  }
  const classified = Object.values(seconds).reduce((a, b) => a + b, 0);
  return { seconds, classified, unclassified, sessions: count };
}

/** Assez de données pour une répartition qui ait un sens : 3 séances et 2 h de temps classé. */
export const MIN_INTENSITY_SESSIONS = 3;
export const MIN_INTENSITY_SECONDS = 2 * 3600;

export type AdherenceStatus = "done" | "partial" | "skipped" | "fit" | "none";

export interface Adherence {
  counts: Record<AdherenceStatus, number>;
  total: number;
}

/**
 * Séances passées et leur suivi, d'après les retours de l'athlète puis les fichiers FIT rattachés.
 * Une séance confirmée seulement par une activité Strava compte « sans retour » : elle ne peut pas
 * entrer dans une statistique (règles de Strava).
 */
export function adherence(
  sessions: StatSession[],
  completions: Map<string, "done" | "partial" | "skipped">,
  fitAttached: Set<string>,
  from: string,
  today: string,
): Adherence {
  const counts: Record<AdherenceStatus, number> = { done: 0, partial: 0, skipped: 0, fit: 0, none: 0 };
  let total = 0;
  for (const session of sessions) {
    if (!isCounted(session) || session.scheduled_date < from || session.scheduled_date >= today) continue;
    total += 1;
    const declared = completions.get(session.id);
    if (declared) counts[declared] += 1;
    else if (fitAttached.has(session.id)) counts.fit += 1;
    else counts.none += 1;
  }
  return { counts, total };
}

export interface ThresholdRow {
  sport: string;
  metric: string;
  value: number | string;
  effective_from: string;
}

export interface ThresholdSeries {
  key: string;
  points: { date: string; value: number }[];
}

/** Historique de chaque seuil, du plus ancien au plus récent. */
export function thresholdSeries(rows: ThresholdRow[], keys: string[]): ThresholdSeries[] {
  return keys.map((key) => ({
    key,
    points: rows
      .filter((r) => `${r.sport}.${r.metric}` === key)
      .map((r) => ({ date: r.effective_from, value: Number(r.value) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export interface RecordEntry {
  key: string;
  label: string;
  value: number;
  unit: "duration" | "distance" | "watts" | "pace_km" | "pace_100m";
  date: string;
}

/** Records tirés des fichiers FIT importés (résumés d'activité : pas de meilleurs efforts par durée). */
export function fitRecords(activities: StatActivity[]): RecordEntry[] {
  const records: RecordEntry[] = [];
  const best = <T,>(list: T[], score: (item: T) => number | null) => {
    let top: { item: T; value: number } | null = null;
    for (const item of list) {
      const value = score(item);
      if (value !== null && Number.isFinite(value) && (!top || value > top.value)) top = { item, value };
    }
    return top;
  };
  const time = (a: StatActivity) => a.moving_s ?? a.elapsed_s;
  for (const sport of ["swim", "bike", "run"] as const) {
    const list = activities.filter((a) => a.sport === sport);
    const longest = best(list, (a) => time(a));
    if (longest) records.push({ key: `${sport}.duration`, label: "Plus longue séance", value: longest.value, unit: "duration", date: longest.item.local_date });
    const farthest = best(list, (a) => a.distance_m);
    if (farthest && farthest.value > 0) records.push({ key: `${sport}.distance`, label: "Plus longue distance", value: farthest.value, unit: "distance", date: farthest.item.local_date });
  }
  // Puissance moyenne sur une sortie d'au moins 20 minutes.
  const power = best(activities.filter((a) => a.sport === "bike" && (time(a) ?? 0) >= 1200), (a) => a.avg_power);
  if (power) records.push({ key: "bike.power", label: "Meilleure puissance moyenne (sortie de 20 min ou plus)", value: power.value, unit: "watts", date: power.item.local_date });
  // Allure moyenne : course d'au moins 5 km, natation d'au moins 400 m.
  const run = best(activities.filter((a) => a.sport === "run" && (a.distance_m ?? 0) >= 5000), (a) => a.avg_speed_mps);
  if (run) records.push({ key: "run.pace", label: "Meilleure allure moyenne (5 km ou plus)", value: 1000 / run.value, unit: "pace_km", date: run.item.local_date });
  const swim = best(activities.filter((a) => a.sport === "swim" && (a.distance_m ?? 0) >= 400), (a) => a.avg_speed_mps);
  if (swim) records.push({ key: "swim.pace", label: "Meilleure allure moyenne (400 m ou plus)", value: 100 / swim.value, unit: "pace_100m", date: swim.item.local_date });
  return records;
}
