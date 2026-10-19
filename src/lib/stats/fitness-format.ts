/** Mise en forme partagée de la condition physique (serveur et navigateur). */
import type { FormZoneKey } from "./fitness";

/** Couleur de chaque zone de forme (variables du thème, clair et sombre). */
export const ZONE_COLOR: Record<FormZoneKey, string> = {
  transition: "var(--chart-bike)",
  fresh: "var(--chart-swim)",
  grey: "var(--chart-other)",
  optimal: "var(--success)",
  risk: "var(--danger)",
};

/** Nombre arrondi avec son signe : « +12 », « −6 », « 0 ». */
export function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : "0";
}
