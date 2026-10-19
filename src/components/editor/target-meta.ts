/** Libellés, saisie et valeurs par défaut des cibles d’étape, par couple métrique.unité. */
import { resolveTarget } from "@/lib/workout/compute";
import { targetForStep } from "@/lib/workout/edit";
import { formatClock } from "@/lib/workout/format";
import { formatNumberInput, parseNumber, parsePace } from "@/lib/workout/inputs";
import { SPORT_TARGETS, TARGET_BOUNDS, type SegmentSport, type StepType, type Target } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";

export type TargetKey = keyof typeof TARGET_BOUNDS;

export function targetKey(target: Pick<Target, "metric" | "unit">): string {
  return `${target.metric}.${target.unit}`;
}

export function targetLabel(key: string, sport: SegmentSport): string {
  const labels: Record<string, string> = {
    "power.percent_ftp": "% FTP",
    "power.watts": "Puissance (W)",
    "power.zone": "Zone de puissance",
    "heart_rate.bpm": "FC (bpm)",
    "heart_rate.percent_lthr": "% FC seuil",
    "heart_rate.percent_max_hr": "% FC max",
    "heart_rate.zone": "Zone de FC",
    "pace.sec_per_km": "Allure (/km)",
    "pace.sec_per_100m": "Allure (/100 m)",
    "pace.percent_threshold": sport === "swim" ? "% vitesse CSS" : "% vitesse seuil",
    "pace.zone": "Zone d’allure",
    "speed.kmh": "Vitesse (km/h)",
    "cadence.rpm": "Cadence (rpm)",
    "cadence.spm": "Cadence (pas/min)",
    "rpe.scale": "RPE (1 à 10)",
  };
  return labels[key] ?? key;
}

/** Suffixe court affiché à côté des valeurs saisies. */
export function targetSuffix(key: string): string {
  const suffix: Record<string, string> = {
    "power.percent_ftp": "%",
    "power.watts": "W",
    "power.zone": "",
    "heart_rate.bpm": "bpm",
    "heart_rate.percent_lthr": "%",
    "heart_rate.percent_max_hr": "%",
    "heart_rate.zone": "",
    "pace.sec_per_km": "/km",
    "pace.sec_per_100m": "/100 m",
    "pace.percent_threshold": "%",
    "pace.zone": "",
    "speed.kmh": "km/h",
    "cadence.rpm": "rpm",
    "cadence.spm": "pas/min",
    "rpe.scale": "",
  };
  return suffix[key] ?? "";
}

export const isPaceKey = (key: string) => key === "pace.sec_per_km" || key === "pace.sec_per_100m";
export const isZoneKey = (key: string) => key.endsWith(".zone");

export function parseTargetValue(key: string, raw: string): number | null {
  return isPaceKey(key) ? parsePace(raw) : parseNumber(raw.replace(/^z/i, ""));
}

export function formatTargetValue(key: string, value: number): string {
  if (isPaceKey(key)) return formatClock(value);
  return formatNumberInput(value);
}

export function allowedTargetKeys(sport: SegmentSport): string[] {
  return [...SPORT_TARGETS[sport]];
}

/**
 * Valeurs de départ quand on ajoute une cible ou qu’on change d’unité : adaptées au type d’étape,
 * déduites des seuils de l’athlète quand il les a, sinon plausibles et jamais présentées comme calculées.
 */
export function defaultTargetFor(key: string, sport: SegmentSport, thresholds?: AthleteThresholds, type: StepType = "active"): Target {
  return targetForStep(key, sport, type, thresholds);
}

/** Valeur absolue correspondante pour l’athlète (« ≈ 217–228 W »), ou la raison de son absence. */
export function resolvedHint(target: Target, sport: SegmentSport, thresholds?: AthleteThresholds): { text: string; missing: boolean } | null {
  const key = targetKey(target);
  if (["power.watts", "heart_rate.bpm", "pace.sec_per_km", "pace.sec_per_100m", "speed.kmh", "cadence.rpm", "cadence.spm", "rpe.scale"].includes(key)) {
    return null;
  }
  const resolution = resolveTarget(target, sport, thresholds);
  if (!resolution.ok) {
    const missing: Record<string, string> = {
      bike_ftp: "FTP manquante",
      bike_lthr: "FC seuil vélo manquante",
      run_lthr: "FC seuil course manquante",
      max_hr: "FC max manquante",
      run_threshold_pace: "allure seuil manquante",
      swim_css: "CSS manquante",
      unsupported: "non convertible",
    };
    return { text: missing[resolution.missing] ?? "seuil manquant", missing: true };
  }
  const t = resolution.target;
  const range = (min: number, max: number, f: (n: number) => string) => (min === max ? f(min) : `${f(min)}–${f(max)}`);
  switch (t.metric) {
    case "power":
      return { text: `${range(t.min, t.max, String)} W`, missing: false };
    case "heart_rate":
      return { text: `${range(t.min, t.max, String)} bpm`, missing: false };
    case "pace":
      return { text: `${range(t.min, t.max, formatClock)} ${t.unit === "sec_per_km" ? "/km" : "/100 m"}`, missing: false };
    default:
      return null;
  }
}
