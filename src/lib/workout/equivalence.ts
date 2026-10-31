/**
 * Équivalence entre zones théoriques : fréquence cardiaque ↔ allure en course, fréquence cardiaque ↔
 * puissance à vélo. Une valeur placée à un endroit d'une zone de FC correspond au même endroit de la
 * zone de même numéro de l'autre mesure (interpolation linéaire entre les bornes des zones), avec les
 * modèles de zones de zones.ts : FC en % de la FC seuil (5 zones), allure en % de la vitesse seuil
 * (5 zones), puissance en % de la FTP (zones 1 à 5 de Coggan ; la FC ne suit pas les zones 6 et 7).
 *
 * Sert à transmettre une séance avec un seul type de cible (intervals.icu n'en trace qu'un) et à donner
 * la FC qui correspond à une allure ou une puissance. C'est une correspondance de modèle, pas une
 * mesure : elle est toujours présentée comme telle.
 */
import { resolveTarget } from "./compute";
import type { SegmentSport, Target } from "./schema";
import { HR_ZONES, lthrFor, PACE_ZONES, POWER_ZONES, zoneSpan, type AthleteThresholds, type ZoneRange } from "./zones";

/** Mesure d'effort de la discipline, vers laquelle la FC est convertie. */
export type EffortMetric = "pace" | "power";

const HR_ZONE_COUNT = 5;

/** Repères d'une échelle : borne basse de chacune des 5 zones, puis borne haute de la 5e. */
const knots = (zones: readonly ZoneRange[]) => [...zones.slice(0, HR_ZONE_COUNT).map((z) => z.min), zones[HR_ZONE_COUNT - 1].max];

function scales(sport: SegmentSport): { hr: number[]; effort: number[]; metric: EffortMetric; effortZones: readonly ZoneRange[]; hrZones: readonly ZoneRange[] } | null {
  if (sport === "run") return { hr: knots(HR_ZONES.run), effort: knots(PACE_ZONES.run), metric: "pace", effortZones: PACE_ZONES.run, hrZones: HR_ZONES.run };
  if (sport === "bike") return { hr: knots(HR_ZONES.bike), effort: knots(POWER_ZONES), metric: "power", effortZones: POWER_ZONES, hrZones: HR_ZONES.bike };
  return null;
}

/** Interpolation linéaire par morceaux d'une échelle de repères vers l'autre, bornée aux extrémités. */
function interpolate(value: number, from: number[], to: number[]): number {
  if (value <= from[0]) return to[0];
  for (let i = 1; i < from.length; i += 1) {
    if (value <= from[i]) return to[i - 1] + ((value - from[i - 1]) / (from[i] - from[i - 1])) * (to[i] - to[i - 1]);
  }
  return to[to.length - 1];
}

/** Mesure d'effort vers laquelle convertir la FC de la discipline (course : allure, vélo : puissance). */
export function effortMetricFor(sport: SegmentSport): EffortMetric | null {
  return scales(sport)?.metric ?? null;
}

/** Plage de FC d'une cible, en % de la FC seuil de la discipline (null si elle ne s'y ramène pas). */
export function hrPercentOfThreshold(target: Target, sport: SegmentSport, thresholds?: AthleteThresholds): { min: number; max: number } | null {
  const s = scales(sport);
  if (!s || target.metric !== "heart_rate") return null;
  if (target.unit === "percent_lthr") return { min: target.min, max: target.max };
  if (target.unit === "zone") return zoneSpan(s.hrZones, target.min, Math.min(target.max, HR_ZONE_COUNT));
  const lthr = lthrFor(sport, thresholds);
  if (!lthr) return null;
  const resolved = resolveTarget(target, sport, thresholds);
  if (!resolved.ok || resolved.target.metric !== "heart_rate") return null;
  return { min: (resolved.target.min / lthr) * 100, max: (resolved.target.max / lthr) * 100 };
}

/**
 * Cible de FC → cible équivalente en allure (course) ou en puissance (vélo). Une zone donne la zone de
 * même numéro ; une plage (% FC seuil, bpm, % FC max) donne la plage correspondante, en % de la vitesse
 * seuil ou de la FTP. null : la FC ne se ramène pas à la FC seuil (bpm sans FC seuil, par exemple).
 */
export function hrTargetAsEffort(target: Target, sport: SegmentSport, thresholds?: AthleteThresholds): Target | null {
  const s = scales(sport);
  if (!s || target.metric !== "heart_rate") return null;
  if (target.unit === "zone") {
    const min = Math.min(target.min, HR_ZONE_COUNT);
    const max = Math.min(target.max, HR_ZONE_COUNT);
    return { metric: s.metric, unit: "zone", min, max } as Target;
  }
  const pct = hrPercentOfThreshold(target, sport, thresholds);
  if (!pct) return null;
  const min = Math.round(interpolate(pct.min, s.hr, s.effort));
  const max = Math.round(interpolate(pct.max, s.hr, s.effort));
  return { metric: s.metric, unit: s.metric === "pace" ? "percent_threshold" : "percent_ftp", min: Math.max(1, min), max: Math.max(1, max) } as Target;
}

/** Plage d'effort d'une cible d'allure ou de puissance, en % de la vitesse seuil ou de la FTP. */
function effortPercent(target: Target, sport: SegmentSport, thresholds?: AthleteThresholds): { min: number; max: number } | null {
  const s = scales(sport);
  if (!s || target.metric !== s.metric) return null;
  if (target.unit === "zone") return zoneSpan(s.effortZones, target.min, target.max);
  if (target.unit === "percent_threshold" || target.unit === "percent_ftp") return { min: target.min, max: target.max };
  if (target.unit === "sec_per_km") {
    const pace = thresholds?.run?.thresholdPaceSPerKm;
    if (sport !== "run" || !pace) return null;
    // Plus l'allure est rapide (moins de secondes), plus le pourcentage de vitesse est haut.
    return { min: (pace / target.max) * 100, max: (pace / target.min) * 100 };
  }
  if (target.unit === "watts") {
    const ftp = thresholds?.bike?.ftpW;
    if (sport !== "bike" || !ftp) return null;
    return { min: (target.min / ftp) * 100, max: (target.max / ftp) * 100 };
  }
  return null;
}

export interface HeartRateEquivalent {
  /** En % de la FC seuil de la discipline. */
  percent: { min: number; max: number };
  /** En bpm, quand la FC seuil de la discipline est connue. */
  bpm: { min: number; max: number } | null;
  /** Zones de FC couvertes. */
  zones: { min: number; max: number };
}

/** Numéro de la zone qui contient un pourcentage (les bornes entières laissent un écart d'une unité). */
function zoneOf(zones: readonly ZoneRange[], percent: number): number {
  const index = zones.findIndex((z, i) => percent < (zones[i + 1]?.min ?? Number.POSITIVE_INFINITY));
  return zones[Math.max(0, index)].zone;
}

/** Plage de FC (zones, % FC seuil, bpm) qui correspond à une plage en % de la FC seuil. */
export function heartRateRange(percent: { min: number; max: number }, sport: SegmentSport, thresholds?: AthleteThresholds): HeartRateEquivalent | null {
  const s = scales(sport);
  if (!s) return null;
  const lthr = lthrFor(sport, thresholds);
  return {
    percent,
    bpm: lthr ? { min: Math.round((lthr * percent.min) / 100), max: Math.round((lthr * percent.max) / 100) } : null,
    zones: { min: zoneOf(s.hrZones, percent.min), max: zoneOf(s.hrZones, percent.max) },
  };
}

/** FC qui correspond, d'après les zones théoriques, à une cible d'allure (course) ou de puissance (vélo). */
export function heartRateEquivalent(target: Target, sport: SegmentSport, thresholds?: AthleteThresholds): HeartRateEquivalent | null {
  const s = scales(sport);
  const effort = effortPercent(target, sport, thresholds);
  if (!s || !effort) return null;
  return heartRateRange({ min: interpolate(effort.min, s.effort, s.hr), max: interpolate(effort.max, s.effort, s.hr) }, sport, thresholds);
}
