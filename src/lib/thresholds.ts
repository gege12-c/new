/** Définition des seuils saisis par l'athlète ou son coach, et conversion pour les calculs. */
import type { AthleteThresholds } from "@/lib/workout/zones";
import { formatClock } from "@/lib/workout/format";

export type ThresholdSport = "bike" | "run" | "swim" | "general";

export interface ThresholdDef {
  key: string;
  sport: ThresholdSport;
  metric: string;
  group: string;
  label: string;
  unit: string;
  input: "number" | "pace";
  min: number;
  max: number;
  step?: number;
  help?: string;
}

export const THRESHOLD_DEFS: readonly ThresholdDef[] = [
  { key: "bike.ftp_w", sport: "bike", metric: "ftp_w", group: "Vélo", label: "FTP", unit: "W", input: "number", min: 30, max: 700, help: "Puissance tenue environ une heure." },
  { key: "bike.lthr_bpm", sport: "bike", metric: "lthr_bpm", group: "Vélo", label: "FC au seuil", unit: "bpm", input: "number", min: 80, max: 220 },
  { key: "run.threshold_pace_s_per_km", sport: "run", metric: "threshold_pace_s_per_km", group: "Course à pied", label: "Allure seuil", unit: "/km", input: "pace", min: 150, max: 900, help: "Format min:s, par exemple 4:10." },
  { key: "run.lthr_bpm", sport: "run", metric: "lthr_bpm", group: "Course à pied", label: "FC au seuil", unit: "bpm", input: "number", min: 80, max: 220 },
  { key: "swim.css_s_per_100m", sport: "swim", metric: "css_s_per_100m", group: "Natation", label: "CSS", unit: "/100 m", input: "pace", min: 50, max: 300, help: "Vitesse critique de nage, format min:s." },
  { key: "general.max_hr_bpm", sport: "general", metric: "max_hr_bpm", group: "Général", label: "FC max", unit: "bpm", input: "number", min: 100, max: 230 },
  { key: "general.resting_hr_bpm", sport: "general", metric: "resting_hr_bpm", group: "Général", label: "FC de repos", unit: "bpm", input: "number", min: 25, max: 120 },
  { key: "general.weight_kg", sport: "general", metric: "weight_kg", group: "Général", label: "Poids", unit: "kg", input: "number", min: 25, max: 250, step: 0.1 },
];

export const thresholdDef = (sport: string, metric: string) =>
  THRESHOLD_DEFS.find((d) => d.sport === sport && d.metric === metric);

/** « 4:35 » → 275 ; accepte aussi un nombre de secondes. Renvoie null si illisible. */
export function parsePace(raw: string): number | null {
  const text = raw.trim();
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

export function formatThresholdValue(def: ThresholdDef, value: number): string {
  if (def.input === "pace") return `${formatClock(value)} ${def.unit}`;
  const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
  return `${number} ${def.unit}`;
}

export type ThresholdRow = { sport: string; metric: string; value: number; effective_from: string };

/** Valeur en vigueur à une date (AAAA-MM-JJ) pour chaque seuil. */
export function currentThresholds(rows: ThresholdRow[], onDate: string): Map<string, ThresholdRow> {
  const current = new Map<string, ThresholdRow>();
  for (const row of rows) {
    if (row.effective_from > onDate) continue;
    const key = `${row.sport}.${row.metric}`;
    const existing = current.get(key);
    if (!existing || existing.effective_from < row.effective_from) current.set(key, row);
  }
  return current;
}

/** Convertit les seuils en vigueur vers la structure utilisée par les calculs de séance. */
export function toAthleteThresholds(current: Map<string, ThresholdRow>): AthleteThresholds {
  const value = (key: string) => (current.has(key) ? Number(current.get(key)!.value) : undefined);
  return {
    bike: { ftpW: value("bike.ftp_w"), lthrBpm: value("bike.lthr_bpm") },
    run: { thresholdPaceSPerKm: value("run.threshold_pace_s_per_km"), lthrBpm: value("run.lthr_bpm") },
    swim: { cssSPer100m: value("swim.css_s_per_100m") },
    general: {
      maxHrBpm: value("general.max_hr_bpm"),
      restingHrBpm: value("general.resting_hr_bpm"),
      weightKg: value("general.weight_kg"),
    },
  };
}
