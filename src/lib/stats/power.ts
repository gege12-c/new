/**
 * Records de la saison, à la manière d'intervals.icu : courbe de puissance (meilleure moyenne de
 * chaque durée, de 5 s à 2 h, à vélo) et courbes d'allure (meilleur temps par distance, en course
 * et en natation), sur 6 semaines, 3 mois et 12 mois, avec la date de chaque record. Seules
 * comptent les activités dont la courbe a été lue seconde par seconde (montre via intervals.icu,
 * fichier FIT) : rien n'est estimé.
 */
import { addDays } from "@/lib/planning/dates";
import { CURVE_DURATIONS, PACE_DISTANCES, StoredBestsSchema, StoredPaceSchema, type CurveDuration, type PaceSport } from "@/lib/activities/streams";

export const POWER_PERIODS = [
  { key: "42", days: 42, label: "6 semaines" },
  { key: "90", days: 90, label: "3 mois" },
  { key: "365", days: 365, label: "12 mois" },
] as const;
export type PowerPeriodKey = (typeof POWER_PERIODS)[number]["key"];

export interface PowerBestEntry {
  watts: number;
  date: string;
  activityId: string;
}

export interface PowerCurve {
  /** Meilleure moyenne par durée et par période ; absente quand aucune activité ne la couvre. */
  bests: Record<CurveDuration, Partial<Record<PowerPeriodKey, PowerBestEntry>>>;
  /** Activités avec puissance des 12 derniers mois. */
  activities: number;
}

export function powerCurve(rows: { activityId: string; date: string; bests: unknown }[], today: string): PowerCurve {
  const bests = Object.fromEntries(CURVE_DURATIONS.map((d) => [d, {}])) as PowerCurve["bests"];
  let activities = 0;
  for (const row of rows) {
    const parsed = StoredBestsSchema.safeParse(row.bests);
    if (!parsed.success || row.date > today || row.date <= addDays(today, -365)) continue;
    const values = parsed.data as Partial<Record<`${CurveDuration}`, number>>;
    if (!Object.values(values).some(Boolean)) continue;
    activities += 1;
    for (const duration of CURVE_DURATIONS) {
      const watts = values[`${duration}`];
      if (!watts) continue;
      for (const period of POWER_PERIODS) {
        if (row.date <= addDays(today, -period.days)) continue;
        const current = bests[duration][period.key];
        if (!current || watts > current.watts || (watts === current.watts && row.date > current.date)) {
          bests[duration][period.key] = { watts, date: row.date, activityId: row.activityId };
        }
      }
    }
  }
  return { bests, activities };
}

export interface PaceBestEntry {
  /** Meilleur temps (s) sur la distance. */
  seconds: number;
  date: string;
  activityId: string;
}

export interface PaceCurve {
  sport: PaceSport;
  /** Meilleur temps par distance (m) et par période. */
  bests: Record<number, Partial<Record<PowerPeriodKey, PaceBestEntry>>>;
  /** Activités de 12 mois avec un temps sur au moins une distance. */
  activities: number;
}

export function paceCurve(rows: { activityId: string; date: string; sport: string; pace: unknown }[], sport: PaceSport, today: string): PaceCurve {
  const distances = PACE_DISTANCES[sport];
  const bests = Object.fromEntries(distances.map((d) => [d, {}])) as PaceCurve["bests"];
  let activities = 0;
  for (const row of rows) {
    if (row.sport !== sport || row.date > today || row.date <= addDays(today, -365)) continue;
    const parsed = StoredPaceSchema.safeParse(row.pace);
    if (!parsed.success || !Object.keys(parsed.data).length) continue;
    activities += 1;
    for (const distance of distances) {
      const seconds = parsed.data[`${distance}`];
      if (!seconds) continue;
      for (const period of POWER_PERIODS) {
        if (row.date <= addDays(today, -period.days)) continue;
        const current = bests[distance][period.key];
        if (!current || seconds < current.seconds || (seconds === current.seconds && row.date > current.date)) {
          bests[distance][period.key] = { seconds, date: row.date, activityId: row.activityId };
        }
      }
    }
  }
  return { sport, bests, activities };
}
