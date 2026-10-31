/**
 * Efforts prévus et réalisés : chaque étape d'effort de la séance (répétitions déroulées) face à
 * l'effort correspondant de l'activité (intervalles d'effort détectés par intervals.icu, ou tours
 * marqués « effort » par la montre), dans l'ordre. La cible prévue est convertie en valeur réelle
 * avec les seuils de l'athlète à la date de la séance ; rien n'est comparé sans cible convertible
 * ni mesure réalisée. Quand le nombre d'efforts diffère, la comparaison le dit.
 */
import { expandWorkout, resolveTarget } from "@/lib/workout/compute";
import { describeLength, describeTarget } from "@/lib/workout/format";
import type { SegmentSport, Target, Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import type { ActivityLap } from "./streams";

/** Écart toléré autour de la cible avant de la dire manquée (arrondis, capteurs). */
const TOLERANCE = 0.02;

export type EffortVerdict = "in" | "above" | "below" | "unknown";

export interface EffortRow {
  /** Rang de l'effort (1, 2…). */
  rank: number;
  planned: { length: string; target: string | null } | null;
  actual: { durationS: number; value: string | null } | null;
  verdict: EffortVerdict;
  /** Pour une allure : au-dessus = plus rapide. */
  metric: "power" | "heart_rate" | "pace" | null;
}

export interface EffortComparison {
  rows: EffortRow[];
  planned: number;
  detected: number;
}

const COMPARED: Target["metric"][] = ["power", "pace", "heart_rate"];

function actualValue(lap: ActivityLap, metric: EffortRow["metric"], sport: SegmentSport): number | null {
  if (metric === "power") return lap.avg_power;
  if (metric === "heart_rate") return lap.avg_hr;
  if (metric === "pace" && lap.avg_speed_mps && lap.avg_speed_mps > 0) return Math.round((sport === "swim" ? 100 : 1000) / lap.avg_speed_mps);
  return null;
}

function formatActual(value: number, metric: EffortRow["metric"], sport: SegmentSport): string {
  if (metric === "power") return `${value} W`;
  if (metric === "heart_rate") return `${value} bpm`;
  return describeTarget({ metric: "pace", unit: sport === "swim" ? "sec_per_100m" : "sec_per_km", min: value, max: value }, sport);
}

/** Comparaison des efforts d'une séance et d'une activité de la même discipline ; null si rien à comparer. */
export function compareEfforts(workout: Workout, thresholds: AthleteThresholds | undefined, laps: ActivityLap[], activitySport: string): EffortComparison | null {
  const sport = activitySport as SegmentSport;
  const plannedSteps = expandWorkout(workout).filter((flat) => flat.sport === sport && flat.step.type === "active" && flat.step.length.unit !== "reps");
  const detected = laps.filter((lap) => lap.kind === "work");
  if (!plannedSteps.length || !detected.length) return null;

  const count = Math.max(plannedSteps.length, detected.length);
  const rows: EffortRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const flat = plannedSteps[i];
    const lap = detected[i];
    let metric: EffortRow["metric"] = null;
    let range: { min: number; max: number } | null = null;
    let targetText: string | null = null;
    if (flat) {
      const target = COMPARED.map((m) => flat.step.targets.find((t) => t.metric === m)).find(Boolean);
      if (target) {
        const resolved = resolveTarget(target, sport, thresholds);
        if (resolved.ok && (resolved.target.metric === "power" || resolved.target.metric === "heart_rate" || resolved.target.metric === "pace")) {
          metric = resolved.target.metric;
          range = { min: Math.min(resolved.target.min, resolved.target.max), max: Math.max(resolved.target.min, resolved.target.max) };
          targetText = describeTarget(resolved.target as Target, sport);
        } else {
          targetText = describeTarget(target, sport);
        }
      }
    }
    const value = lap ? actualValue(lap, metric, sport) : null;
    let verdict: EffortVerdict = "unknown";
    if (range && value !== null) {
      const low = range.min * (1 - TOLERANCE);
      const high = range.max * (1 + TOLERANCE);
      // Allure : moins de secondes = plus rapide = au-dessus de la cible.
      if (metric === "pace") verdict = value < low ? "above" : value > high ? "below" : "in";
      else verdict = value > high ? "above" : value < low ? "below" : "in";
    }
    rows.push({
      rank: i + 1,
      planned: flat ? { length: describeLength(flat.step.length, sport), target: targetText } : null,
      actual: lap ? { durationS: lap.duration_s, value: value !== null && metric ? formatActual(value, metric, sport) : null } : null,
      verdict,
      metric,
    });
  }
  return { rows, planned: plannedSteps.length, detected: detected.length };
}
