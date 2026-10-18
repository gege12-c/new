/**
 * Seuils de l'athlète et modèles de zones par défaut.
 *
 * Les zones sont exprimées en pourcentage d'un seuil :
 * - puissance : % de FTP (modèle de Coggan, 7 zones) ;
 * - fréquence cardiaque : % de FC au seuil (modèle de Friel simplifié, 5 zones, propre à chaque sport) ;
 * - allure : % de la VITESSE au seuil (course : allure seuil ; natation : CSS), 5 zones.
 * Ces modèles sont documentés dans docs/WORKOUT_FORMAT.md ; des zones personnalisées viendront plus tard.
 */
import type { SegmentSport } from "./schema";

export interface AthleteThresholds {
  bike?: { ftpW?: number; lthrBpm?: number };
  run?: { thresholdPaceSPerKm?: number; lthrBpm?: number };
  swim?: { cssSPer100m?: number };
  general?: { maxHrBpm?: number; restingHrBpm?: number; weightKg?: number };
}

export type ZoneRange = { zone: number; label: string; min: number; max: number };

/** Puissance, % FTP (Coggan). La zone 7 est plafonnée à 200 % pour le calcul. */
export const POWER_ZONES: readonly ZoneRange[] = [
  { zone: 1, label: "Récupération active", min: 0, max: 55 },
  { zone: 2, label: "Endurance", min: 56, max: 75 },
  { zone: 3, label: "Tempo", min: 76, max: 90 },
  { zone: 4, label: "Seuil", min: 91, max: 105 },
  { zone: 5, label: "VO2max", min: 106, max: 120 },
  { zone: 6, label: "Anaérobie", min: 121, max: 150 },
  { zone: 7, label: "Neuromusculaire", min: 151, max: 200 },
];

/** Fréquence cardiaque, % FC au seuil (Friel simplifié). */
export const HR_ZONES: Record<"bike" | "run", readonly ZoneRange[]> = {
  bike: [
    { zone: 1, label: "Récupération", min: 50, max: 80 },
    { zone: 2, label: "Endurance", min: 81, max: 89 },
    { zone: 3, label: "Tempo", min: 90, max: 93 },
    { zone: 4, label: "Seuil", min: 94, max: 99 },
    { zone: 5, label: "Au-dessus du seuil", min: 100, max: 106 },
  ],
  run: [
    { zone: 1, label: "Récupération", min: 50, max: 84 },
    { zone: 2, label: "Endurance", min: 85, max: 89 },
    { zone: 3, label: "Tempo", min: 90, max: 94 },
    { zone: 4, label: "Seuil", min: 95, max: 99 },
    { zone: 5, label: "Au-dessus du seuil", min: 100, max: 106 },
  ],
};

/** Allure, % de la vitesse au seuil (plus le pourcentage est haut, plus c'est rapide). */
export const PACE_ZONES: Record<"run" | "swim", readonly ZoneRange[]> = {
  run: [
    { zone: 1, label: "Récupération", min: 60, max: 77 },
    { zone: 2, label: "Endurance", min: 78, max: 87 },
    { zone: 3, label: "Tempo", min: 88, max: 94 },
    { zone: 4, label: "Seuil", min: 95, max: 101 },
    { zone: 5, label: "VMA", min: 102, max: 112 },
  ],
  swim: [
    { zone: 1, label: "Récupération", min: 70, max: 84 },
    { zone: 2, label: "Endurance", min: 85, max: 92 },
    { zone: 3, label: "Tempo", min: 93, max: 97 },
    { zone: 4, label: "Seuil (CSS)", min: 98, max: 102 },
    { zone: 5, label: "Vitesse", min: 103, max: 112 },
  ],
};

/** Plage en % couvrant les zones [fromZone, toZone]. */
export function zoneSpan(
  zones: readonly ZoneRange[],
  fromZone: number,
  toZone: number,
): { min: number; max: number } | null {
  const first = zones.find((z) => z.zone === fromZone);
  const last = zones.find((z) => z.zone === toZone);
  if (!first || !last) return null;
  return { min: first.min, max: last.max };
}

export function hrZonesFor(sport: SegmentSport): readonly ZoneRange[] | null {
  if (sport === "bike") return HR_ZONES.bike;
  if (sport === "run") return HR_ZONES.run;
  return null;
}

export function paceZonesFor(sport: SegmentSport): readonly ZoneRange[] | null {
  if (sport === "run") return PACE_ZONES.run;
  if (sport === "swim") return PACE_ZONES.swim;
  return null;
}

/** FC au seuil pertinente pour la discipline (vélo et course ont chacun la leur). */
export function lthrFor(sport: SegmentSport, t: AthleteThresholds | undefined): number | undefined {
  if (sport === "bike") return t?.bike?.lthrBpm;
  if (sport === "run") return t?.run?.lthrBpm;
  return undefined;
}

/** Allure seuil en secondes par mètre pour la discipline (course : /km, natation : CSS /100 m). */
export function thresholdSecondsPerMeter(
  sport: SegmentSport,
  t: AthleteThresholds | undefined,
): number | undefined {
  if (sport === "run" && t?.run?.thresholdPaceSPerKm) return t.run.thresholdPaceSPerKm / 1000;
  if (sport === "swim" && t?.swim?.cssSPer100m) return t.swim.cssSPer100m / 100;
  return undefined;
}
