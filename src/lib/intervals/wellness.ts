/**
 * Mesures du matin reçues d'intervals.icu (FC au repos, VFC, durée du sommeil, poids), telles que les
 * montres et balances les lui transmettent. Elles complètent la forme du jour de l'athlète sans
 * jamais remplacer ce qu'il a saisi lui-même ; une mesure absente reste absente.
 */
import { z } from "zod";
import { boundedDecimal, boundedInt } from "@/lib/activities/schema";

export const WELLNESS_RECENT_DAYS = 14;

const number = z.number().nullish().catch(null);
const WellnessDaySchema = z
  .object({ id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), restingHR: number, hrv: number, sleepSecs: number, weight: number })
  .loose();

export interface MorningMeasures {
  entry_date: string;
  resting_hr: number | null;
  hrv_ms: number | null;
  sleep_hours: number | null;
  weight_kg: number | null;
}

/** Jours lisibles et porteurs d'au moins une mesure, bornées comme en base. */
export function morningMeasures(rows: unknown[]): MorningMeasures[] {
  const out: MorningMeasures[] = [];
  for (const row of rows) {
    const parsed = WellnessDaySchema.safeParse(row);
    if (!parsed.success) continue;
    const d = parsed.data;
    const measures: MorningMeasures = {
      entry_date: d.id,
      resting_hr: boundedInt(d.restingHR, 25, 150),
      hrv_ms: boundedInt(d.hrv, 1, 300),
      sleep_hours: typeof d.sleepSecs === "number" ? boundedDecimal(d.sleepSecs / 3600, 0, 24, 1) : null,
      weight_kg: boundedDecimal(d.weight, 25, 250, 1),
    };
    if (measures.resting_hr !== null || measures.hrv_ms !== null || measures.sleep_hours !== null || measures.weight_kg !== null) out.push(measures);
  }
  return out;
}

export type StoredMorning = { entry_date: string } & Partial<Record<"resting_hr" | "hrv_ms" | "sleep_hours" | "weight_kg", number | string | null>>;

/** Ce qu'il faut écrire pour un jour : seulement les champs vides chez TriCoach ; null s'il n'y a rien à faire. */
export function missingMeasures(upstream: MorningMeasures, stored: StoredMorning | undefined): Partial<MorningMeasures> | null {
  const changes: Partial<MorningMeasures> = {};
  for (const key of ["resting_hr", "hrv_ms", "sleep_hours", "weight_kg"] as const) {
    const value = upstream[key];
    if (value === null) continue;
    if (stored && stored[key] !== null && stored[key] !== undefined) continue;
    changes[key] = value;
  }
  return Object.keys(changes).length ? changes : null;
}
