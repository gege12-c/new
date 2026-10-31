/**
 * Tendances des mesures du matin (VFC, FC au repos, sommeil, poids), à la manière d'intervals.icu :
 * moyenne des 7 derniers jours comparée à la zone habituelle de l'athlète, tirée des 60 jours
 * d'avant (moyenne ± un écart type). Rien n'est tracé ni jugé sur trop peu de jours.
 */
import { addDays, dateRange } from "@/lib/planning/dates";
import type { MeasureKey, WellnessEntry } from "./wellness";

/** Fenêtre tracée. */
export const MEASURE_DAYS = 90;
const RECENT_DAYS = 7;
const BASELINE_DAYS = 60;
/** Jours renseignés au moins : sur la référence, et sur les 7 derniers jours. */
const MIN_BASELINE = 14;
const MIN_RECENT = 3;
/** Largeur minimale de la zone habituelle (sans quoi deux semaines très régulières la rendent trop étroite). */
const MIN_HALF_BAND: Record<MeasureKey, number> = { hrv_ms: 3, resting_hr: 2, sleep_hours: 0.5, weight_kg: 0.5 };

export interface MeasureTrend {
  key: MeasureKey;
  days: string[];
  values: (number | null)[];
  last: number | null;
  /** Moyenne des 7 derniers jours (3 valeurs au moins). */
  recent: number | null;
  /** Zone habituelle : moyenne ± un écart type des 60 jours d'avant. */
  band: { low: number; high: number; mean: number } | null;
  /** Où se situe la moyenne récente par rapport à la zone habituelle. */
  status: "below" | "within" | "above" | null;
  known: number;
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export function measureTrend(entries: WellnessEntry[], key: MeasureKey, today: string): MeasureTrend {
  const days = dateRange(addDays(today, -(MEASURE_DAYS - 1)), today);
  const byDay = new Map(entries.map((e) => [e.entry_date, e]));
  const values = days.map((day) => {
    const v = byDay.get(day)?.[key];
    return v === null || v === undefined ? null : Number(v);
  });
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));
  const baselineFrom = addDays(recentFrom, -BASELINE_DAYS);
  const pick = (from: string, to: string) => days.flatMap((d, i) => (d >= from && d <= to && values[i] !== null ? [values[i] as number] : []));
  const recentValues = pick(recentFrom, today);
  const baselineValues = pick(baselineFrom, addDays(recentFrom, -1));
  const recent = recentValues.length >= MIN_RECENT ? average(recentValues) : null;
  let band: MeasureTrend["band"] = null;
  if (baselineValues.length >= MIN_BASELINE) {
    const mean = average(baselineValues);
    const sd = Math.sqrt(average(baselineValues.map((v) => (v - mean) ** 2)));
    const half = Math.max(sd, MIN_HALF_BAND[key]);
    band = { low: mean - half, high: mean + half, mean };
  }
  const status = recent === null || !band ? null : recent < band.low ? "below" : recent > band.high ? "above" : "within";
  const known = values.filter((v) => v !== null).length;
  const last = [...values].reverse().find((v) => v !== null) ?? null;
  return { key, days, values, last, recent, band, status, known };
}
