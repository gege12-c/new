/** Couleurs (classes du thème, validées pour les graphiques) et noms des disciplines des statistiques. */
import type { StatSport } from "./stats";

export const SPORT_FILL: Record<StatSport, string> = {
  swim: "bg-chart-swim",
  bike: "bg-chart-bike",
  strength: "bg-chart-strength",
  run: "bg-chart-run",
  other: "bg-chart-other",
};

export const SPORT_NAME: Record<StatSport, string> = {
  swim: "Natation",
  bike: "Vélo",
  strength: "Renforcement",
  run: "Course à pied",
  other: "Autre",
};
