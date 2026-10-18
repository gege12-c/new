/**
 * Détection des incohérences de prescription.
 * Les avertissements informent le coach ; ils ne modifient jamais la séance.
 */
import { computeTotals, intensityPercent, resolveTarget, type MissingThreshold } from "./compute";
import { formatDuration } from "./format";
import { SPORT_LABELS, type SegmentSport, type Step, type Workout, type WorkoutNode } from "./schema";
import type { AthleteThresholds } from "./zones";

export type IssueSeverity = "info" | "warning";

export type WorkoutIssueCode =
  | "missing_threshold"
  | "duration_unknown"
  | "above_max_hr"
  | "sustained_high_intensity"
  | "recovery_harder_than_work"
  | "intense_warmup"
  | "rest_with_target"
  | "transition_outside_brick"
  | "single_repeat"
  | "very_short_step"
  | "very_long_total"
  | "wide_target_range";

export interface WorkoutIssue {
  code: WorkoutIssueCode;
  severity: IssueSeverity;
  message: string;
  /** Identifiant du bloc concerné, pour le surligner dans l'éditeur. */
  nodeId?: string;
}

const MISSING_LABELS: Record<Exclude<MissingThreshold, "unsupported">, string> = {
  bike_ftp: "FTP vélo non renseignée : les cibles en % FTP ou en zones de puissance ne sont pas converties en watts.",
  bike_lthr: "FC au seuil vélo non renseignée : les cibles cardiaques relatives ne sont pas converties en bpm.",
  run_lthr: "FC au seuil course non renseignée : les cibles cardiaques relatives ne sont pas converties en bpm.",
  max_hr: "FC maximale non renseignée : les cibles en % FC max ne sont pas converties en bpm.",
  run_threshold_pace: "Allure seuil course non renseignée : les cibles relatives ne sont pas converties en allure.",
  swim_css: "CSS natation non renseignée : les cibles relatives ne sont pas converties en allure.",
};

/** Seuils au-delà desquels une intensité continue est jugée inhabituelle (en % du seuil). */
const SUSTAINED_RULES: { sport: SegmentSport; minPercent: number; maxSeconds: number; label: string }[] = [
  { sport: "bike", minPercent: 121, maxSeconds: 8 * 60, label: "au-dessus de 120 % de la FTP" },
  { sport: "bike", minPercent: 106, maxSeconds: 20 * 60, label: "au-dessus de 105 % de la FTP" },
  { sport: "run", minPercent: 103, maxSeconds: 25 * 60, label: "plus vite que l'allure seuil" },
  { sport: "swim", minPercent: 104, maxSeconds: 15 * 60, label: "plus vite que la CSS" },
];

const LONG_TOTALS: Partial<Record<SegmentSport, number>> = {
  bike: 8 * 3600,
  run: 4 * 3600,
  swim: 2.5 * 3600,
};

function forEachStep(
  workout: Workout,
  visit: (step: Step, sport: SegmentSport, siblings: WorkoutNode[], index: number) => void,
  onRepeat?: (repeat: Extract<WorkoutNode, { kind: "repeat" }>) => void,
) {
  const walk = (nodes: WorkoutNode[], sport: SegmentSport) => {
    nodes.forEach((node, index) => {
      if (node.kind === "repeat") {
        onRepeat?.(node);
        walk(node.steps, sport);
      } else {
        visit(node, sport, nodes, index);
      }
    });
  };
  for (const segment of workout.segments) walk(segment.steps, segment.sport);
}

/** Étape de travail qui précède une récupération (dans la même liste, ou la dernière de la répétition précédente). */
function previousWorkStep(siblings: WorkoutNode[], index: number): Step | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const node = siblings[i];
    if (node.kind === "step") {
      if (node.type === "active") return node;
      if (node.type !== "recovery" && node.type !== "rest") return null;
    } else {
      return null;
    }
  }
  return null;
}

export function analyzeWorkout(workout: Workout, thresholds?: AthleteThresholds): WorkoutIssue[] {
  const issues: WorkoutIssue[] = [];
  const missing = new Set<Exclude<MissingThreshold, "unsupported">>();
  const multiSport = new Set(workout.segments.map((s) => s.sport)).size > 1;
  const maxHr = thresholds?.general?.maxHrBpm;

  forEachStep(
    workout,
    (step, sport, siblings, index) => {
      for (const target of step.targets) {
        const resolved = resolveTarget(target, sport, thresholds);
        if (!resolved.ok) {
          if (resolved.missing !== "unsupported") missing.add(resolved.missing);
          continue;
        }
        if (resolved.target.metric === "heart_rate" && maxHr && resolved.target.max > maxHr) {
          issues.push({
            code: "above_max_hr",
            severity: "warning",
            message: `Cible cardiaque (${resolved.target.max} bpm) au-dessus de la FC max renseignée (${maxHr} bpm).`,
            nodeId: step.id,
          });
        }
      }

      const percent = intensityPercent(step, sport, thresholds);
      const seconds = step.length.unit === "time" ? step.length.seconds : null;

      if (percent !== null && seconds !== null && step.type === "active") {
        const rule = SUSTAINED_RULES.find((r) => r.sport === sport && percent >= r.minPercent && seconds > r.maxSeconds);
        if (rule) {
          issues.push({
            code: "sustained_high_intensity",
            severity: "warning",
            message: `Effort continu de ${Math.round(seconds / 60)} min ${rule.label} : durée inhabituelle à cette intensité.`,
            nodeId: step.id,
          });
        }
      }

      if ((step.type === "warmup" || step.type === "cooldown") && percent !== null && percent >= 91) {
        issues.push({
          code: "intense_warmup",
          severity: "warning",
          message:
            step.type === "warmup"
              ? "Échauffement prescrit au niveau du seuil ou au-dessus."
              : "Retour au calme prescrit au niveau du seuil ou au-dessus.",
          nodeId: step.id,
        });
      }

      if (step.type === "recovery" || step.type === "rest") {
        const work = previousWorkStep(siblings, index);
        const workPercent = work ? intensityPercent(work, sport, thresholds) : null;
        if (percent !== null && workPercent !== null && percent >= workPercent) {
          issues.push({
            code: "recovery_harder_than_work",
            severity: "warning",
            message: "La récupération est aussi intense, ou plus, que l'effort qui la précède.",
            nodeId: step.id,
          });
        }
      }

      if (step.type === "rest" && step.targets.length > 0) {
        issues.push({
          code: "rest_with_target",
          severity: "info",
          message: "Une étape de repos porte une cible : certains appareils l'ignoreront.",
          nodeId: step.id,
        });
      }

      if (step.type === "transition" && !multiSport) {
        issues.push({
          code: "transition_outside_brick",
          severity: "warning",
          message: "Étape de transition dans une séance d'une seule discipline.",
          nodeId: step.id,
        });
      }

      if (step.length.unit === "time" && step.length.seconds < 5) {
        issues.push({
          code: "very_short_step",
          severity: "info",
          message: `Étape de ${step.length.seconds} s : vérifiez l'unité de durée.`,
          nodeId: step.id,
        });
      }

      for (const target of step.targets) {
        const width = target.max - target.min;
        const tooWide =
          (target.unit === "percent_ftp" && width > 30) ||
          (target.unit === "watts" && width > 120) ||
          (target.unit === "sec_per_km" && width > 60) ||
          (target.unit === "sec_per_100m" && width > 20) ||
          (target.unit === "bpm" && width > 30) ||
          (target.unit === "zone" && width >= 3);
        if (tooWide) {
          issues.push({
            code: "wide_target_range",
            severity: "info",
            message: "Plage de cible très large : l'appareil guidera peu l'athlète.",
            nodeId: step.id,
          });
          break;
        }
      }
    },
    (repeat) => {
      if (repeat.count === 1) {
        issues.push({
          code: "single_repeat",
          severity: "info",
          message: "Répétition exécutée une seule fois.",
          nodeId: repeat.id,
        });
      }
    },
  );

  for (const key of missing) {
    issues.push({ code: "missing_threshold", severity: "info", message: MISSING_LABELS[key] });
  }

  const totals = computeTotals(workout, thresholds);
  if (totals.duration.unknownSteps > 0) {
    issues.push({
      code: "duration_unknown",
      severity: "info",
      message: `${totals.duration.unknownSteps} étape(s) sans durée calculable : la durée totale est incomplète.`,
    });
  }
  for (const [sport, limit] of Object.entries(LONG_TOTALS) as [SegmentSport, number][]) {
    const seconds = totals.bySport[sport]?.durationSeconds ?? 0;
    if (seconds > limit) {
      issues.push({
        code: "very_long_total",
        severity: "warning",
        message: `${formatDuration(seconds)} de ${SPORT_LABELS[sport].toLowerCase()} dans une seule séance : vérifiez la prescription.`,
      });
    }
  }

  return issues;
}
