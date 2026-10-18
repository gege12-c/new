/** Mise en forme des mesures d’une activité et des écarts au prévu. */
import { formatDistance, formatDurationShort, formatPace } from "@/lib/workout/format";
import type { ActivitySport } from "./schema";

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const MINUS = "−";

/** Allure (course, natation) ou vitesse (vélo, autres) à partir d’une vitesse moyenne en m/s. */
export function formatSpeed(speedMps: number | null, sport: ActivitySport): { label: string; value: string } | null {
  if (!speedMps || speedMps <= 0) return null;
  if (sport === "run") return { label: "Allure moyenne", value: formatPace(1000 / speedMps, "sec_per_km") };
  if (sport === "swim") return { label: "Allure moyenne", value: formatPace(100 / speedMps, "sec_per_100m") };
  return { label: "Vitesse moyenne", value: `${decimal.format(speedMps * 3.6)} km/h` };
}

export function formatSignedDuration(deltaS: number): string {
  if (Math.abs(deltaS) < 30) return "±0 min";
  return `${deltaS > 0 ? "+" : MINUS}${formatDurationShort(Math.abs(deltaS))}`;
}

export function formatSignedDistance(deltaM: number, sport?: ActivitySport | "brick"): string {
  if (Math.abs(deltaM) < 1) return "±0 m";
  return `${deltaM > 0 ? "+" : MINUS}${formatDistance(Math.abs(deltaM), sport === "swim" ? "swim" : undefined)}`;
}

export function formatSignedPercent(percent: number): string {
  if (percent === 0) return "0 %";
  return `${percent > 0 ? "+" : MINUS}${Math.abs(percent)} %`;
}
