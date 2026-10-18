/**
 * Calculs sur une séance : résolution des cibles, déroulé des répétitions, durée et distance.
 *
 * Règle : aucune valeur inventée. Chaque quantité est « exacte » (prescrite), « estimée »
 * (déduite d’une cible et des seuils de l’athlète, selon une hypothèse documentée) ou « inconnue ».
 */
import type { SegmentSport, Step, Target, Workout, WorkoutNode } from "./schema";
import {
  type AthleteThresholds,
  POWER_ZONES,
  hrZonesFor,
  lthrFor,
  paceZonesFor,
  thresholdSecondsPerMeter,
  zoneSpan,
} from "./zones";

export type ResolvedTarget =
  | { metric: "power"; unit: "watts"; min: number; max: number }
  | { metric: "heart_rate"; unit: "bpm"; min: number; max: number }
  /** Allure : `min` = borne rapide (moins de secondes). */
  | { metric: "pace"; unit: "sec_per_km" | "sec_per_100m"; min: number; max: number }
  | { metric: "speed"; unit: "kmh"; min: number; max: number }
  | { metric: "cadence"; unit: "rpm" | "spm"; min: number; max: number }
  | { metric: "rpe"; unit: "scale"; min: number; max: number };

export type MissingThreshold =
  | "bike_ftp"
  | "bike_lthr"
  | "run_lthr"
  | "max_hr"
  | "run_threshold_pace"
  | "swim_css"
  | "unsupported";

export type TargetResolution =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; missing: MissingThreshold };

const round = (n: number) => Math.round(n);

function paceUnitFor(sport: SegmentSport): "sec_per_km" | "sec_per_100m" | null {
  if (sport === "run") return "sec_per_km";
  if (sport === "swim") return "sec_per_100m";
  return null;
}

function missingPaceThreshold(sport: SegmentSport): MissingThreshold {
  return sport === "swim" ? "swim_css" : sport === "run" ? "run_threshold_pace" : "unsupported";
}

/** Convertit une plage en % de vitesse seuil en plage d’allure absolue. */
function paceFromPercent(
  sport: SegmentSport,
  minPct: number,
  maxPct: number,
  thresholds: AthleteThresholds | undefined,
): TargetResolution {
  const secPerMeter = thresholdSecondsPerMeter(sport, thresholds);
  const unit = paceUnitFor(sport);
  if (!unit) return { ok: false, missing: "unsupported" };
  if (!secPerMeter) return { ok: false, missing: missingPaceThreshold(sport) };
  const meters = unit === "sec_per_km" ? 1000 : 100;
  return {
    ok: true,
    target: {
      metric: "pace",
      unit,
      // Plus le pourcentage de vitesse est élevé, plus l’allure (en secondes) est basse.
      min: round((secPerMeter * meters) / (maxPct / 100)),
      max: round((secPerMeter * meters) / (minPct / 100)),
    },
  };
}

/** Exprime une cible en valeurs absolues à l’aide des seuils de l’athlète. */
export function resolveTarget(
  target: Target,
  sport: SegmentSport,
  thresholds?: AthleteThresholds,
): TargetResolution {
  const { min, max } = target;
  switch (`${target.metric}.${target.unit}`) {
    case "power.watts":
      return { ok: true, target: { metric: "power", unit: "watts", min, max } };
    case "power.percent_ftp":
    case "power.zone": {
      const ftp = sport === "bike" ? thresholds?.bike?.ftpW : undefined;
      if (sport !== "bike") return { ok: false, missing: "unsupported" };
      if (!ftp) return { ok: false, missing: "bike_ftp" };
      const pct = target.unit === "zone" ? zoneSpan(POWER_ZONES, min, max) : { min, max };
      if (!pct) return { ok: false, missing: "unsupported" };
      return {
        ok: true,
        target: { metric: "power", unit: "watts", min: round((ftp * pct.min) / 100), max: round((ftp * pct.max) / 100) },
      };
    }
    case "heart_rate.bpm":
      return { ok: true, target: { metric: "heart_rate", unit: "bpm", min, max } };
    case "heart_rate.percent_lthr":
    case "heart_rate.zone": {
      const zones = hrZonesFor(sport);
      if (!zones) return { ok: false, missing: "unsupported" };
      const lthr = lthrFor(sport, thresholds);
      if (!lthr) return { ok: false, missing: sport === "bike" ? "bike_lthr" : "run_lthr" };
      const pct = target.unit === "zone" ? zoneSpan(zones, min, max) : { min, max };
      if (!pct) return { ok: false, missing: "unsupported" };
      return {
        ok: true,
        target: { metric: "heart_rate", unit: "bpm", min: round((lthr * pct.min) / 100), max: round((lthr * pct.max) / 100) },
      };
    }
    case "heart_rate.percent_max_hr": {
      const maxHr = thresholds?.general?.maxHrBpm;
      if (!maxHr) return { ok: false, missing: "max_hr" };
      return {
        ok: true,
        target: { metric: "heart_rate", unit: "bpm", min: round((maxHr * min) / 100), max: round((maxHr * max) / 100) },
      };
    }
    case "pace.sec_per_km":
      return { ok: true, target: { metric: "pace", unit: "sec_per_km", min, max } };
    case "pace.sec_per_100m":
      return { ok: true, target: { metric: "pace", unit: "sec_per_100m", min, max } };
    case "pace.percent_threshold":
      return paceFromPercent(sport, min, max, thresholds);
    case "pace.zone": {
      const zones = paceZonesFor(sport);
      const pct = zones ? zoneSpan(zones, min, max) : null;
      if (!pct) return { ok: false, missing: "unsupported" };
      return paceFromPercent(sport, pct.min, pct.max, thresholds);
    }
    case "speed.kmh":
      return { ok: true, target: { metric: "speed", unit: "kmh", min, max } };
    case "cadence.rpm":
      return { ok: true, target: { metric: "cadence", unit: "rpm", min, max } };
    case "cadence.spm":
      return { ok: true, target: { metric: "cadence", unit: "spm", min, max } };
    case "rpe.scale":
      return { ok: true, target: { metric: "rpe", unit: "scale", min, max } };
    default:
      return { ok: false, missing: "unsupported" };
  }
}

/**
 * Intensité relative d’une étape, en % du seuil (100 = seuil), selon sa cible principale.
 * Puissance : % FTP ; FC : % FC seuil ; allure : % de vitesse seuil ; RPE : RPE × 10.
 * Renvoie null si l’intensité ne peut pas être exprimée sans inventer de valeur.
 */
export function intensityPercent(
  step: Step,
  sport: SegmentSport,
  thresholds?: AthleteThresholds,
): number | null {
  for (const target of step.targets) {
    const mid = (target.min + target.max) / 2;
    const key = `${target.metric}.${target.unit}`;
    if (key === "power.percent_ftp" || key === "pace.percent_threshold" || key === "heart_rate.percent_lthr") return mid;
    if (key === "power.zone") {
      const span = zoneSpan(POWER_ZONES, target.min, target.max);
      if (span) return (span.min + span.max) / 2;
    }
    if (key === "pace.zone") {
      const zones = paceZonesFor(sport);
      const span = zones ? zoneSpan(zones, target.min, target.max) : null;
      if (span) return (span.min + span.max) / 2;
    }
    if (key === "heart_rate.zone") {
      const zones = hrZonesFor(sport);
      const span = zones ? zoneSpan(zones, target.min, target.max) : null;
      if (span) return (span.min + span.max) / 2;
    }
    if (key === "power.watts" && sport === "bike" && thresholds?.bike?.ftpW) return (mid / thresholds.bike.ftpW) * 100;
    if (key === "heart_rate.bpm") {
      const lthr = lthrFor(sport, thresholds);
      if (lthr) return (mid / lthr) * 100;
    }
    if (key === "pace.sec_per_km" || key === "pace.sec_per_100m") {
      const secPerMeter = thresholdSecondsPerMeter(sport, thresholds);
      if (secPerMeter) {
        const meters = key === "pace.sec_per_km" ? 1000 : 100;
        return ((secPerMeter * meters) / mid) * 100;
      }
    }
    if (key === "rpe.scale") return mid * 10;
  }
  return null;
}

/** Hypothèse documentée : une étape facile sans cible d’allure se fait à ce % de la vitesse seuil. */
export const EASY_SPEED_RATIO: Partial<Record<SegmentSport, number>> = { run: 0.8, swim: 0.85 };
const EASY_STEP_TYPES = new Set(["warmup", "cooldown", "recovery", "drill"]);

/** Vitesse (m/s) déduite des cibles ou des seuils, avec la qualité de l’estimation. */
function speedFor(
  step: Step,
  sport: SegmentSport,
  thresholds?: AthleteThresholds,
): { speed: number; quality: "exact" | "estimated" } | null {
  for (const target of step.targets) {
    if (target.metric !== "pace" && target.metric !== "speed") continue;
    const resolved = resolveTarget(target, sport, thresholds);
    if (!resolved.ok) continue;
    const t = resolved.target;
    if (t.metric === "speed") return { speed: (t.min + t.max) / 2 / 3.6, quality: "estimated" };
    if (t.metric === "pace") {
      const meters = t.unit === "sec_per_km" ? 1000 : 100;
      return { speed: (meters / t.min + meters / t.max) / 2, quality: "estimated" };
    }
  }
  // Cible de FC en zone : on suppose la zone d’allure de même rang (estimation).
  const hrZone = step.targets.find((t) => t.metric === "heart_rate" && t.unit === "zone");
  const paceZones = paceZonesFor(sport);
  const secPerMeter = thresholdSecondsPerMeter(sport, thresholds);
  if (hrZone && paceZones && secPerMeter) {
    const span = zoneSpan(paceZones, hrZone.min, hrZone.max);
    if (span) return { speed: ((span.min + span.max) / 200) * (1 / secPerMeter), quality: "estimated" };
  }
  const easyRatio = EASY_SPEED_RATIO[sport];
  const hasIntensityTarget = step.targets.some((t) => t.metric !== "cadence");
  if (easyRatio && secPerMeter && EASY_STEP_TYPES.has(step.type) && !hasIntensityTarget) {
    return { speed: easyRatio / secPerMeter, quality: "estimated" };
  }
  return null;
}

export type Quantity =
  | { value: number; quality: "exact" | "estimated" }
  | { value: null; quality: "unknown" };

const exact = (value: number): Quantity => ({ value, quality: "exact" });
const unknown: Quantity = { value: null, quality: "unknown" };

/** Disciplines et types d’étape pour lesquels la distance n’a pas de sens (comptée 0). */
function distanceIsIrrelevant(step: Step, sport: SegmentSport) {
  return sport === "strength" || step.type === "rest" || step.type === "transition";
}

/** Durée et distance d’une étape (une seule occurrence). */
export function stepQuantities(
  step: Step,
  sport: SegmentSport,
  thresholds?: AthleteThresholds,
): { duration: Quantity; distance: Quantity } {
  const length = step.length;
  const noDistance = distanceIsIrrelevant(step, sport);

  if (length.unit === "time") {
    const duration = exact(length.seconds);
    if (noDistance) return { duration, distance: exact(0) };
    const speed = speedFor(step, sport, thresholds);
    return {
      duration,
      distance: speed ? { value: speed.speed * length.seconds, quality: "estimated" } : unknown,
    };
  }

  if (length.unit === "distance") {
    const distance = noDistance ? exact(0) : exact(length.meters);
    if (step.sendOffSeconds !== undefined) return { duration: exact(step.sendOffSeconds), distance };
    const speed = speedFor(step, sport, thresholds);
    return {
      duration: speed ? { value: length.meters / speed.speed, quality: "estimated" } : unknown,
      distance,
    };
  }

  // Répétitions (renforcement) ou durée libre : pas de durée calculable.
  return { duration: unknown, distance: noDistance ? exact(0) : unknown };
}

export interface FlatStep {
  step: Step;
  sport: SegmentSport;
  segmentIndex: number;
  /** Rang de l’itération dans chaque répétition englobante (de l’extérieur vers l’intérieur). */
  iterations: number[];
}

/** Déroule les répétitions : une entrée par étape effectivement réalisée. */
export function expandWorkout(workout: Workout): FlatStep[] {
  const out: FlatStep[] = [];
  const walk = (nodes: WorkoutNode[], sport: SegmentSport, segmentIndex: number, iterations: number[]) => {
    for (const node of nodes) {
      if (node.kind === "step") {
        out.push({ step: node, sport, segmentIndex, iterations });
      } else {
        for (let i = 0; i < node.count; i += 1) walk(node.steps, sport, segmentIndex, [...iterations, i]);
      }
    }
  };
  workout.segments.forEach((segment, index) => walk(segment.steps, segment.sport, index, []));
  return out;
}

export type TotalStatus = "exact" | "estimated" | "partial" | "unknown";

export interface QuantityTotal {
  /** Somme des parties connues (exactes et estimées). */
  value: number;
  status: TotalStatus;
  /** Nombre d’étapes déroulées dont la valeur est inconnue. */
  unknownSteps: number;
}

export interface WorkoutTotals {
  duration: QuantityTotal;
  distance: QuantityTotal;
  bySport: Partial<Record<SegmentSport, { durationSeconds: number; distanceMeters: number }>>;
}

class Accumulator {
  value = 0;
  known = 0;
  estimated = 0;
  unknownSteps = 0;

  add(q: Quantity, times: number) {
    if (q.value === null) {
      this.unknownSteps += times;
      return;
    }
    this.value += q.value * times;
    this.known += times;
    if (q.quality === "estimated") this.estimated += times;
  }

  result(): QuantityTotal {
    let status: TotalStatus;
    if (this.known === 0) status = "unknown";
    else if (this.unknownSteps > 0) status = "partial";
    else if (this.estimated > 0) status = "estimated";
    else status = "exact";
    return { value: this.value, status, unknownSteps: this.unknownSteps };
  }
}

/** Durée totale (s) et distance totale (m) de la séance. */
export function computeTotals(workout: Workout, thresholds?: AthleteThresholds): WorkoutTotals {
  const duration = new Accumulator();
  const distance = new Accumulator();
  const bySport: WorkoutTotals["bySport"] = {};

  const walk = (nodes: WorkoutNode[], sport: SegmentSport, times: number) => {
    for (const node of nodes) {
      if (node.kind === "repeat") {
        walk(node.steps, sport, times * node.count);
        continue;
      }
      const q = stepQuantities(node, sport, thresholds);
      duration.add(q.duration, times);
      distance.add(q.distance, times);
      const bucket = (bySport[sport] ??= { durationSeconds: 0, distanceMeters: 0 });
      if (q.duration.value !== null) bucket.durationSeconds += q.duration.value * times;
      if (q.distance.value !== null) bucket.distanceMeters += q.distance.value * times;
    }
  };
  for (const segment of workout.segments) walk(segment.steps, segment.sport, 1);

  return { duration: duration.result(), distance: distance.result(), bySport };
}
