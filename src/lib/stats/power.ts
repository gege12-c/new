/**
 * Meilleures puissances sur plusieurs périodes (courbe de puissance, à la manière d'intervals.icu) :
 * pour chaque durée (5 s à 60 min), la meilleure moyenne des activités à vélo de la période, et sa
 * date. Seules comptent les activités dont la courbe a été lue (montre via intervals.icu, fichier
 * FIT, avec un capteur de puissance) : rien n'est estimé.
 */
import { addDays } from "@/lib/planning/dates";
import { POWER_BEST_DURATIONS, StoredBestsSchema, type PowerBestDuration } from "@/lib/activities/streams";

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
  bests: Record<PowerBestDuration, Partial<Record<PowerPeriodKey, PowerBestEntry>>>;
  /** Activités avec puissance des 12 derniers mois. */
  activities: number;
}

export function powerCurve(rows: { activityId: string; date: string; bests: unknown }[], today: string): PowerCurve {
  const bests = Object.fromEntries(POWER_BEST_DURATIONS.map((d) => [d, {}])) as PowerCurve["bests"];
  let activities = 0;
  for (const row of rows) {
    const parsed = StoredBestsSchema.safeParse(row.bests);
    if (!parsed.success || row.date > today) continue;
    const values = parsed.data as Partial<Record<`${PowerBestDuration}`, number>>;
    if (!Object.values(values).some(Boolean)) continue;
    activities += row.date > addDays(today, -365) ? 1 : 0;
    for (const duration of POWER_BEST_DURATIONS) {
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
