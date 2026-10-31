/**
 * Zones d'entraînement en valeurs réelles (watts, bpm, allures), tirées des seuils de l'athlète par
 * la même conversion que les séances (resolveTarget) : « Z2 » dans une séance et la zone 2 affichée
 * ici donnent toujours les mêmes valeurs. Une zone ouverte (la première, la dernière) est dite
 * « moins de » ou « plus de » plutôt que bornée par la limite de calcul.
 */
import { resolveTarget } from "./compute";
import { formatClock } from "./format";
import { HR_ZONES, PACE_ZONES, POWER_ZONES, type AthleteThresholds, type ZoneRange } from "./zones";
import type { SegmentSport, Target } from "./schema";

export interface ZoneRow {
  zone: number;
  label: string;
  range: string;
}

export interface ZoneTable {
  key: string;
  title: string;
  /** Seuil de référence, tel qu'affiché : « FTP 250 W ». */
  basis: string;
  rows: ZoneRow[];
}

type Kind = "power" | "heart_rate" | "pace";

function rows(zones: readonly ZoneRange[], kind: Kind, sport: SegmentSport, t: AthleteThresholds): ZoneRow[] | null {
  const out: ZoneRow[] = [];
  for (const [index, z] of zones.entries()) {
    const target = { metric: kind, unit: "zone", min: z.zone, max: z.zone } as Target;
    const resolved = resolveTarget(target, sport, t);
    if (!resolved.ok) return null;
    const { min, max } = resolved.target;
    const first = index === 0;
    const last = index === zones.length - 1;
    let range: string;
    if (kind === "pace") {
      // Allures : plus la zone est haute, plus l'allure est rapide (moins de secondes).
      const unit = sport === "swim" ? "/100 m" : "/km";
      const fast = formatClock(Math.min(min, max));
      const slow = formatClock(Math.max(min, max));
      range = first ? `plus lent que ${fast} ${unit}` : last ? `plus vite que ${slow} ${unit}` : `${slow} à ${fast} ${unit}`;
    } else {
      const unit = kind === "power" ? "W" : "bpm";
      range = first ? `moins de ${max} ${unit}` : last ? `plus de ${min} ${unit}` : `${min} à ${max} ${unit}`;
    }
    out.push({ zone: z.zone, label: z.label, range });
  }
  return out;
}

/** Tables de zones que les seuils renseignés permettent de calculer (aucune sinon). */
export function zoneTables(t: AthleteThresholds): ZoneTable[] {
  const tables: ZoneTable[] = [];
  const add = (key: string, title: string, basis: string, zones: readonly ZoneRange[], kind: Kind, sport: SegmentSport) => {
    const computed = rows(zones, kind, sport, t);
    if (computed) tables.push({ key, title, basis, rows: computed });
  };
  if (t.bike?.ftpW) add("bike.power", "Vélo, puissance", `FTP ${t.bike.ftpW} W`, POWER_ZONES, "power", "bike");
  if (t.bike?.lthrBpm) add("bike.hr", "Vélo, fréquence cardiaque", `FC au seuil ${t.bike.lthrBpm} bpm`, HR_ZONES.bike, "heart_rate", "bike");
  if (t.run?.thresholdPaceSPerKm) add("run.pace", "Course, allure", `allure seuil ${formatClock(t.run.thresholdPaceSPerKm)} /km`, PACE_ZONES.run, "pace", "run");
  if (t.run?.lthrBpm) add("run.hr", "Course, fréquence cardiaque", `FC au seuil ${t.run.lthrBpm} bpm`, HR_ZONES.run, "heart_rate", "run");
  if (t.swim?.cssSPer100m) add("swim.pace", "Natation, allure", `CSS ${formatClock(t.swim.cssSPer100m)} /100 m`, PACE_ZONES.swim, "pace", "swim");
  return tables;
}

/** FTP estimée d'un test de 20 minutes : 95 % de la puissance moyenne (méthode d'Allen et Coggan). */
export function ftpFromTwentyMinutes(averageWatts: number): number | null {
  if (!Number.isFinite(averageWatts) || averageWatts < 40 || averageWatts > 750) return null;
  return Math.round(averageWatts * 0.95);
}

/**
 * CSS (vitesse critique de nage) d'un test 400 m + 200 m : (temps du 400 − temps du 200) / 2, en
 * secondes par 100 m. Null si les temps ne tiennent pas debout (400 m plus court que le 200 m…).
 */
export function cssFromTests(seconds400: number, seconds200: number): number | null {
  if (!Number.isFinite(seconds400) || !Number.isFinite(seconds200) || seconds200 <= 0 || seconds400 <= seconds200) return null;
  const css = Math.round((seconds400 - seconds200) / 2);
  // Le 400 m dure normalement un peu plus de deux fois le 200 m ; au-delà de trois fois, une saisie est fausse.
  if (seconds400 > seconds200 * 3 || css < 50 || css > 300) return null;
  return css;
}
