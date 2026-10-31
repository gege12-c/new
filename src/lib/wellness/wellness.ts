/**
 * Forme du jour : échelles subjectives (1 à 5) et mesures du matin, saisies par l’athlète.
 * Rien n’est estimé : une valeur absente reste absente, une tendance demande assez de jours.
 */
import { z } from "zod";

export const SCALES = ["sleep_quality", "fatigue", "soreness", "stress", "motivation"] as const;
export type ScaleKey = (typeof SCALES)[number];

export const SCALE_DEFS: Record<ScaleKey, { label: string; levels: [string, string, string, string, string]; /** 5 = au mieux. */ higherIsBetter: boolean }> = {
  sleep_quality: { label: "Sommeil", levels: ["Très mauvais", "Mauvais", "Moyen", "Bon", "Excellent"], higherIsBetter: true },
  fatigue: { label: "Fatigue", levels: ["Pleine forme", "Reposé", "Normale", "Fatigué", "Épuisé"], higherIsBetter: false },
  soreness: { label: "Courbatures", levels: ["Aucune", "Légères", "Modérées", "Fortes", "Très fortes"], higherIsBetter: false },
  stress: { label: "Stress", levels: ["Très détendu", "Détendu", "Normal", "Stressé", "Très stressé"], higherIsBetter: false },
  motivation: { label: "Motivation", levels: ["Aucune", "Faible", "Normale", "Bonne", "Excellente"], higherIsBetter: true },
};

export const MEASURES = ["sleep_hours", "resting_hr", "hrv_ms", "weight_kg"] as const;
export type MeasureKey = (typeof MEASURES)[number];

export const MEASURE_DEFS: Record<MeasureKey, { label: string; unit: string; min: number; max: number; step: number; decimals: number }> = {
  sleep_hours: { label: "Sommeil", unit: "h", min: 0, max: 24, step: 0.5, decimals: 1 },
  resting_hr: { label: "FC au repos", unit: "bpm", min: 25, max: 150, step: 1, decimals: 0 },
  hrv_ms: { label: "VFC", unit: "ms", min: 1, max: 300, step: 1, decimals: 0 },
  weight_kg: { label: "Poids", unit: "kg", min: 25, max: 250, step: 0.1, decimals: 1 },
};

export interface WellnessEntry {
  entry_date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  fatigue: number | null;
  soreness: number | null;
  stress: number | null;
  motivation: number | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  weight_kg: number | null;
  note: string | null;
}

/** Nombre décimal saisi au clavier français (« 72,5 ») ou vide. */
const decimal = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const n = Number(value.replace(",", "."));
      const problem = !Number.isFinite(n) ? `${label} : nombre attendu.` : n < min ? `${label} : ${min} au moins.` : n > max ? `${label} : ${max} au plus.` : null;
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      return n;
    });

const scale = z
  .string()
  .optional()
  .transform((v) => (v ? Number(v) : null))
  .pipe(z.number().int().min(1).max(5).nullable());

export const WellnessFormSchema = z
  .object({
    entry_date: z.iso.date("Date invalide."),
    sleep_quality: scale,
    fatigue: scale,
    soreness: scale,
    stress: scale,
    motivation: scale,
    sleep_hours: decimal(0, 24, "Sommeil"),
    resting_hr: decimal(25, 150, "FC au repos"),
    hrv_ms: decimal(1, 300, "VFC"),
    weight_kg: decimal(25, 250, "Poids"),
    note: z
      .string()
      .trim()
      .max(300, "300 caractères maximum.")
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .transform((v) => ({
    ...v,
    sleep_hours: v.sleep_hours === null ? null : Math.round(v.sleep_hours * 10) / 10,
    resting_hr: v.resting_hr === null ? null : Math.round(v.resting_hr),
    hrv_ms: v.hrv_ms === null ? null : Math.round(v.hrv_ms),
    weight_kg: v.weight_kg === null ? null : Math.round(v.weight_kg * 10) / 10,
  }))
  .refine((v) => [...SCALES, ...MEASURES, "note" as const].some((k) => v[k] !== null), { message: "Renseignez au moins une valeur." });

export interface WellnessFlag {
  key: string;
  text: string;
}

/** Moyenne d’une mesure sur les jours précédents (au moins `minDays` valeurs), ou null. */
export function baseline(entries: WellnessEntry[], key: MeasureKey, before: string, days = 28, minDays = 5): number | null {
  const from = new Date(Date.parse(`${before}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const values = entries.filter((e) => e.entry_date < before && e.entry_date >= from && e[key] !== null).map((e) => Number(e[key]));
  if (values.length < minDays) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Ce qui mérite l’attention du coach dans la forme d’un jour : échelles au plus mal, nuit courte,
 * FC au repos nettement au-dessus de la moyenne de l’athlète (5 jours de référence au moins).
 */
export function wellnessFlags(entry: WellnessEntry, history: WellnessEntry[] = []): WellnessFlag[] {
  const flags: WellnessFlag[] = [];
  if (entry.fatigue !== null && entry.fatigue >= 4) flags.push({ key: "fatigue", text: SCALE_DEFS.fatigue.levels[entry.fatigue - 1].toLowerCase() });
  if (entry.soreness !== null && entry.soreness >= 4) flags.push({ key: "soreness", text: `courbatures ${SCALE_DEFS.soreness.levels[entry.soreness - 1].toLowerCase()}` });
  if (entry.stress !== null && entry.stress >= 4) flags.push({ key: "stress", text: SCALE_DEFS.stress.levels[entry.stress - 1].toLowerCase() });
  if (entry.motivation !== null && entry.motivation <= 2) flags.push({ key: "motivation", text: `motivation ${SCALE_DEFS.motivation.levels[entry.motivation - 1].toLowerCase()}` });
  if (entry.sleep_quality !== null && entry.sleep_quality <= 2) flags.push({ key: "sleep_quality", text: `sommeil ${SCALE_DEFS.sleep_quality.levels[entry.sleep_quality - 1].toLowerCase()}` });
  if (entry.sleep_hours !== null && entry.sleep_hours < 6) flags.push({ key: "sleep_hours", text: `nuit de ${formatHours(entry.sleep_hours)}` });
  if (entry.resting_hr !== null) {
    const usual = baseline(history, "resting_hr", entry.entry_date);
    if (usual !== null && entry.resting_hr - usual >= 5) flags.push({ key: "resting_hr", text: `FC au repos +${Math.round(entry.resting_hr - usual)} bpm` });
  }
  return flags;
}

export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function formatMeasure(key: MeasureKey, value: number): string {
  if (key === "sleep_hours") return formatHours(value);
  const def = MEASURE_DEFS[key];
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals })} ${def.unit}`;
}
