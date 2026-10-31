/**
 * Seuils estimés d'après les records des 3 derniers mois, à proposer à l'athlète (jamais appliqués
 * sans lui) :
 * - FTP : la plus haute de 95 % de la meilleure puissance sur 20 min (méthode d'Allen et Coggan) et
 *   de la meilleure puissance sur 60 min ;
 * - allure seuil : l'allure tenue environ une heure, tirée du meilleur temps d'un effort de 15 à
 *   75 min, ramené à une heure par la loi de Riegel (temps ∝ distance^1,06).
 * Des records faits à l'entraînement, pas forcément à fond : l'estimation peut être prudente.
 */
import type { PaceCurve, PowerCurve } from "./power";

export const ESTIMATE_PERIOD = "90" as const;
const RIEGEL = 1.06;
const PACE_MIN_S = 15 * 60;
const PACE_MAX_S = 75 * 60;

export interface FtpEstimate {
  watts: number;
  basis: { duration: 1200 | 3600; watts: number; date: string; activityId: string };
}

export function estimateFtp(curve: PowerCurve): FtpEstimate | null {
  const p20 = curve.bests[1200][ESTIMATE_PERIOD];
  const p60 = curve.bests[3600][ESTIMATE_PERIOD];
  const candidates: FtpEstimate[] = [];
  if (p20) candidates.push({ watts: Math.round(p20.watts * 0.95), basis: { duration: 1200, ...p20 } });
  if (p60) candidates.push({ watts: p60.watts, basis: { duration: 3600, ...p60 } });
  if (!candidates.length) return null;
  return candidates.reduce((best, c) => (c.watts > best.watts ? c : best));
}

export interface PaceEstimate {
  /** Allure seuil estimée, s/km. */
  secondsPerKm: number;
  basis: { distance: number; seconds: number; date: string; activityId: string };
}

export function estimateThresholdPace(curve: PaceCurve): PaceEstimate | null {
  if (curve.sport !== "run") return null;
  let chosen: PaceEstimate["basis"] | null = null;
  for (const [distance, periods] of Object.entries(curve.bests)) {
    const best = periods[ESTIMATE_PERIOD];
    if (!best || best.seconds < PACE_MIN_S || best.seconds > PACE_MAX_S) continue;
    // L'effort le plus proche d'une heure renseigne le mieux sur l'allure d'une heure.
    if (!chosen || Math.abs(best.seconds - 3600) < Math.abs(chosen.seconds - 3600)) chosen = { distance: Number(distance), ...best };
  }
  if (!chosen) return null;
  // Distance couverte en une heure selon Riegel : D60 = D × (3600 / T)^(1/1,06).
  const hourDistance = chosen.distance * (3600 / chosen.seconds) ** (1 / RIEGEL);
  return { secondsPerKm: Math.round((3600 / hourDistance) * 1000), basis: chosen };
}
