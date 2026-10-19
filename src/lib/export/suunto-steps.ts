/**
 * Fiche « étapes Suunto » : la séance écrite comme le créateur d'entraînements structurés de
 * l'application Suunto la demande, pour la recopier sans rien recalculer.
 *
 * Ce que demande l'application Suunto (FAQ et article officiels) : un nom et une courte
 * description affichés sur la montre, le mode sportif, une date facultative, puis des étapes et
 * des répétitions. Chaque étape a l'un de quatre types (échauffement, intervalle, récupération,
 * retour au calme), un nom libre, une fin (durée, distance ou appui sur le bouton tour) et un
 * objectif (fréquence cardiaque, puissance, allure ou vitesse).
 *
 * Les cibles relatives sont converties avec les seuils de l'athlète à la date de la séance.
 * Ce que Suunto ne sait pas porter (cadence, effort ressenti, répétitions de renforcement,
 * matériel, consignes, cible secondaire) est écrit à côté de l'étape : rien n'est perdu en
 * silence, et une cible impossible à convertir le dit au lieu d'inventer une valeur.
 */
import { resolveTarget, type MissingThreshold, type ResolvedTarget } from "@/lib/workout/compute";
import { describeTarget, formatClock, formatDistance, formatDuration } from "@/lib/workout/format";
import { EQUIPMENT_LABELS, STEP_TYPE_LABELS, type SegmentSport, type Step, type StepType, type Target, type Workout, type WorkoutNode } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";

export type SuuntoPhase = "Échauffement" | "Intervalle" | "Récupération" | "Retour au calme";

/** Types d'étape de TriCoach vers les quatre types de Suunto. */
const PHASES: Record<StepType, SuuntoPhase> = {
  warmup: "Échauffement",
  active: "Intervalle",
  drill: "Intervalle",
  recovery: "Récupération",
  rest: "Récupération",
  transition: "Récupération",
  cooldown: "Retour au calme",
};

export type SuuntoTargetKind = "heart_rate" | "power" | "pace" | "speed";

export const SUUNTO_TARGET_LABELS: Record<SuuntoTargetKind, string> = {
  heart_rate: "Fréquence cardiaque",
  power: "Puissance",
  pace: "Allure",
  speed: "Vitesse",
};

export interface SuuntoStep {
  kind: "step";
  phase: SuuntoPhase;
  /** Nom libre de l'étape : celui du coach, sinon le type de TriCoach quand Suunto n'a pas le même. */
  name: string | null;
  /** Fin de l'étape, à choisir dans Suunto. */
  end: { kind: "duration" | "distance" | "lap"; text: string };
  /** Objectif à saisir ; null quand la séance n'en donne aucun que Suunto sache suivre. */
  target: { kind: SuuntoTargetKind; value: string } | null;
  /** Ce que Suunto ne garde pas, à lire avant de partir. */
  notes: string[];
}

export interface SuuntoRepeat {
  kind: "repeat";
  count: number;
  name: string | null;
  steps: SuuntoStep[];
}

export type SuuntoItem = SuuntoStep | SuuntoRepeat;

export interface SuuntoSegmentPlan {
  sport: SegmentSport;
  /** Mode sportif à choisir dans Suunto. */
  sportMode: string;
  items: SuuntoItem[];
  /** Étapes à saisir (une étape d'une répétition compte une fois). */
  stepCount: number;
  /** Seuils manquants et adaptations, dits une fois pour toute la partie. */
  warnings: string[];
}

export interface SuuntoPlan {
  name: string;
  /** Courte description affichée sur la montre, ou null. */
  description: string | null;
  segments: SuuntoSegmentPlan[];
}

const SPORT_MODES: Record<SegmentSport, string> = {
  run: "Course à pied",
  bike: "Cyclisme, ou vélo d'intérieur sur home trainer",
  swim: "Natation en piscine (ou en eau libre)",
  strength: "Renforcement musculaire",
  other: "Le mode sportif de votre choix",
};

const MISSING: Record<Exclude<MissingThreshold, "unsupported">, string> = {
  bike_ftp: "FTP vélo non renseignée : les objectifs en % FTP ou en zones de puissance restent sans valeur en watts.",
  bike_lthr: "FC au seuil vélo non renseignée : les objectifs cardiaques relatifs restent sans valeur en bpm.",
  run_lthr: "FC au seuil course non renseignée : les objectifs cardiaques relatifs restent sans valeur en bpm.",
  max_hr: "FC maximale non renseignée : les objectifs en % FC max restent sans valeur en bpm.",
  run_threshold_pace: "Allure seuil course non renseignée : les allures relatives restent sans valeur absolue.",
  swim_css: "CSS natation non renseignée : les allures relatives restent sans valeur absolue.",
};

const MAX_DESCRIPTION = 300;

const range = (min: number, max: number, format: (n: number) => string) => (min === max ? format(min) : `${format(min)}–${format(max)}`);
const integer = (n: number) => String(Math.round(n));
const decimal = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n);

/** Objectif sous la forme que Suunto attend : bpm, W, min:s par km (ou par 100 m), km/h. */
function suuntoTarget(target: ResolvedTarget): SuuntoStep["target"] {
  switch (target.metric) {
    case "power":
      return { kind: "power", value: `${range(target.min, target.max, integer)} W` };
    case "heart_rate":
      return { kind: "heart_rate", value: `${range(target.min, target.max, integer)} bpm` };
    case "pace":
      return { kind: "pace", value: `${range(target.min, target.max, formatClock)} ${target.unit === "sec_per_km" ? "/km" : "/100 m"}` };
    case "speed":
      return { kind: "speed", value: `${range(target.min, target.max, decimal)} km/h` };
    default:
      return null;
  }
}

/** Texte d'une cible que Suunto ne suit pas (cadence, effort ressenti) ou qui reste sans valeur. */
function asNote(target: Target, sport: SegmentSport): string {
  if (target.metric === "rpe") return `Effort ressenti ${range(target.min, target.max, integer)} sur 10`;
  if (target.metric === "cadence") return `Cadence ${describeTarget(target, sport)}`;
  return `Objectif prévu : ${describeTarget(target, sport)}`;
}

function stepFor(step: Step, sport: SegmentSport, thresholds: AthleteThresholds | undefined, warnings: Set<string>): SuuntoStep {
  const notes: string[] = [];
  let target: SuuntoStep["target"] = null;

  for (const t of step.targets) {
    if (t.metric === "cadence" || t.metric === "rpe") {
      notes.push(asNote(t, sport));
      continue;
    }
    const resolution = resolveTarget(t, sport, thresholds);
    if (!resolution.ok) {
      if (resolution.missing !== "unsupported") warnings.add(MISSING[resolution.missing]);
      notes.push(asNote(t, sport));
      continue;
    }
    const converted = suuntoTarget(resolution.target);
    if (!converted) {
      notes.push(asNote(t, sport));
    } else if (target) {
      // Un seul objectif par étape dans Suunto : la seconde cible est écrite à côté.
      notes.push(`Aussi : ${SUUNTO_TARGET_LABELS[converted.kind].toLowerCase()} ${converted.value}`);
    } else {
      target = converted;
    }
  }

  let end: SuuntoStep["end"];
  switch (step.length.unit) {
    case "time":
      end = { kind: "duration", text: formatDuration(step.length.seconds) };
      break;
    case "distance":
      end = { kind: "distance", text: formatDistance(step.length.meters, sport) };
      break;
    case "reps":
      end = { kind: "lap", text: "Bouton tour" };
      notes.unshift(`${step.length.reps} répétitions, puis bouton tour`);
      break;
    case "open":
      end = { kind: "lap", text: "Bouton tour" };
      break;
  }

  if (step.sendOffSeconds) notes.push(`Départ toutes les ${formatClock(step.sendOffSeconds)}`);
  if (step.equipment?.length) notes.push(`Matériel : ${step.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ")}`);
  if (step.notes) notes.push(step.notes.replace(/\s+/g, " ").trim());

  const phase = PHASES[step.type];
  const typeName = STEP_TYPE_LABELS[step.type];
  // Le nom du coach d'abord ; sinon le type de TriCoach quand Suunto le range sous un autre nom.
  const name = step.label?.trim() || (typeName.toLowerCase() !== phase.toLowerCase() && step.type !== "active" ? typeName : null);
  return { kind: "step", phase, name, end, target, notes };
}

/** Étapes d'une liste, répétitions intérieures déroulées : un seul niveau de répétition à saisir. */
function flatten(nodes: WorkoutNode[], sport: SegmentSport, thresholds: AthleteThresholds | undefined, warnings: Set<string>): SuuntoStep[] {
  return nodes.flatMap((node) => {
    if (node.kind === "step") return [stepFor(node, sport, thresholds, warnings)];
    warnings.add("Répétition dans une répétition : elle est déroulée ici, pour n'avoir qu'un niveau de répétition à saisir.");
    const inner = flatten(node.steps, sport, thresholds, warnings);
    return Array.from({ length: node.count }, () => inner).flat();
  });
}

export function suuntoPlan(workout: Workout, options: { title: string; description?: string | null; thresholds?: AthleteThresholds }): SuuntoPlan {
  const multi = workout.segments.length > 1;
  const flat = options.description?.replace(/\s+/g, " ").trim() || null;
  const description = flat && flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 3).trimEnd()}...` : flat;

  return {
    name: options.title,
    description,
    segments: workout.segments.map((segment) => {
      const warnings = new Set<string>();
      const items: SuuntoItem[] = segment.steps.map((node) =>
        node.kind === "step"
          ? stepFor(node, segment.sport, options.thresholds, warnings)
          : { kind: "repeat", count: node.count, name: node.label?.trim() || null, steps: flatten(node.steps, segment.sport, options.thresholds, warnings) },
      );
      if (multi) warnings.add("Enchaînement : chaque partie se crée comme un entraînement Suunto à part, à lancer l'une après l'autre.");
      return {
        sport: segment.sport,
        sportMode: SPORT_MODES[segment.sport],
        items,
        stepCount: items.reduce((n, item) => n + (item.kind === "step" ? 1 : item.steps.length), 0),
        warnings: [...warnings],
      };
    }),
  };
}
