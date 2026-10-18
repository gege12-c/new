/** Prévu contre réalisé : totaux réalisés, écarts en valeur et en pourcentage, taux de réalisation. */
import type { CalendarActivity, CalendarSession } from "@/lib/data/planning-types";

/** Au-delà de 80 % du prévu, la séance est considérée comme faite. */
export const DONE_RATIO = 0.8;

/** Durée qui compte : temps en mouvement en natation, vélo et course ; temps total sinon. */
export function activityDuration(activity: Pick<CalendarActivity, "sport" | "moving_s" | "elapsed_s">): number | null {
  return ["swim", "bike", "run"].includes(activity.sport) ? (activity.moving_s ?? activity.elapsed_s) : (activity.elapsed_s ?? activity.moving_s);
}

export interface RealizedTotals {
  durationS: number | null;
  distanceM: number | null;
}

export function realizedTotals(activities: CalendarActivity[]): RealizedTotals {
  if (!activities.length) return { durationS: null, distanceM: null };
  const durations = activities.map(activityDuration);
  const distances = activities.map((a) => a.distance_m);
  return {
    durationS: durations.every((d) => d === null) ? null : durations.reduce<number>((sum, d) => sum + (d ?? 0), 0),
    distanceM: distances.every((d) => d === null || d === 0) ? null : distances.reduce<number>((sum, d) => sum + (d ?? 0), 0),
  };
}

export interface Deviation {
  /** Réalisé moins prévu (secondes ou mètres). */
  delta: number;
  /** En pourcentage du prévu, arrondi. */
  percent: number;
}

export function deviation(planned: number | null, actual: number | null): Deviation | null {
  if (!planned || planned <= 0 || actual === null) return null;
  return { delta: actual - planned, percent: Math.round(((actual - planned) / planned) * 100) };
}

/** Part du prévu réalisée (durée, sinon distance) ; null si rien n’est comparable. */
export function completionRatio(session: Pick<CalendarSession, "planned_duration_s" | "planned_distance_m">, totals: RealizedTotals): number | null {
  if (session.planned_duration_s && totals.durationS !== null) return totals.durationS / session.planned_duration_s;
  if (session.planned_distance_m && totals.distanceM !== null) return totals.distanceM / session.planned_distance_m;
  return null;
}
