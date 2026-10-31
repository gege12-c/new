/**
 * Séances types : un point de départ en un geste, par discipline (footing, seuil, sweet spot,
 * CSS…). Les intensités suivent les zones théoriques (voir ./zones.ts) et s’expriment comme les
 * cibles de départ de l’éditeur : % de FTP à vélo, % de l’allure seuil ou de la CSS quand elle est
 * connue (ou pour un modèle de la bibliothèque), sinon l’effort ressenti (RPE), qui se passe de
 * tout seuil. Tout reste modifiable ensuite : rien n’est imposé.
 */
import { defaultTarget, newId, workoutShape } from "./edit";
import type { Length, SegmentSport, SessionObjective, SessionSport, Step, StepType, Target, Workout, WorkoutNode } from "./schema";
import type { AthleteThresholds } from "./zones";

/** Intensité d’un bloc, d’après les zones théoriques. */
export type Effort = "recovery" | "endurance" | "tempo" | "sweetspot" | "threshold" | "vo2";

type Band = readonly [number, number];

/**
 * Plages par famille de cibles. Vélo : % FTP (Coggan : Z2 56–75, Z3 76–90, Z4 91–105, Z5 106–120).
 * Course et natation : % de la vitesse au seuil (course : Z2 78–87, Z4 95–101, Z5 102–112 ;
 * natation : Z2 85–92, Z4 98–102). RPE de 1 à 10.
 */
const BANDS: Record<"bike" | "run" | "swim" | "rpe", Record<Effort, Band>> = {
  bike: { recovery: [45, 55], endurance: [60, 75], tempo: [76, 87], sweetspot: [88, 94], threshold: [95, 105], vo2: [106, 120] },
  run: { recovery: [65, 76], endurance: [78, 87], tempo: [88, 94], sweetspot: [92, 96], threshold: [96, 101], vo2: [105, 112] },
  swim: { recovery: [75, 84], endurance: [85, 92], tempo: [93, 97], sweetspot: [95, 98], threshold: [98, 102], vo2: [103, 110] },
  rpe: { recovery: [2, 3], endurance: [3, 4], tempo: [5, 6], sweetspot: [6, 7], threshold: [7, 8], vo2: [8, 9] },
};

const band = (metric: Target["metric"], unit: Target["unit"], [min, max]: Band): Target => ({ metric, unit, min, max });

/** Cible d’un bloc d’intensité donnée, dans la même famille que les cibles de départ de l’éditeur. */
export function effortTarget(sport: SegmentSport, effort: Effort, thresholds?: AthleteThresholds): Target {
  const template = thresholds === undefined;
  if (sport === "bike") return band("power", "percent_ftp", BANDS.bike[effort]);
  if (sport === "run" && (template || thresholds?.run?.thresholdPaceSPerKm)) return band("pace", "percent_threshold", BANDS.run[effort]);
  if (sport === "swim" && (template || thresholds?.swim?.cssSPer100m)) return band("pace", "percent_threshold", BANDS.swim[effort]);
  return band("rpe", "scale", BANDS.rpe[effort]);
}

type StepSpec = { type: StepType; length: Length; effort?: Effort; label?: string };
type RepeatSpec = { repeat: number; steps: StepSpec[] };
type Spec = StepSpec | RepeatSpec;

export interface Starter {
  id: string;
  sport: SessionSport;
  /** Nom du bouton. */
  label: string;
  /** Titre proposé pour la séance. */
  title: string;
  objective: SessionObjective;
  segments: { sport: SegmentSport; steps: Spec[] }[];
}

const min = (n: number): Length => ({ unit: "time", seconds: Math.round(n * 60) });
const sec = (n: number): Length => ({ unit: "time", seconds: n });
const m = (n: number): Length => ({ unit: "distance", meters: n });
const reps = (n: number): Length => ({ unit: "reps", reps: n });

const warmup = (length: Length): StepSpec => ({ type: "warmup", length });
const cooldown = (length: Length): StepSpec => ({ type: "cooldown", length });
const work = (length: Length, effort: Effort, label?: string): StepSpec => ({ type: "active", length, effort, label });
const easy = (length: Length): StepSpec => ({ type: "recovery", length });
const rest = (length: Length): StepSpec => ({ type: "rest", length });

const STARTERS: readonly Starter[] = [
  // Course à pied
  { id: "run-easy", sport: "run", label: "Footing", title: "Footing 45 min", objective: "endurance", segments: [{ sport: "run", steps: [work(min(45), "endurance", "Footing")] }] },
  {
    id: "run-vma",
    sport: "run",
    label: "Fractionné court",
    title: "Fractionné 10 × 1 min",
    objective: "vo2max",
    segments: [{ sport: "run", steps: [warmup(min(20)), { repeat: 10, steps: [work(min(1), "vo2"), easy(min(1))] }, cooldown(min(10))] }],
  },
  {
    id: "run-threshold",
    sport: "run",
    label: "Seuil",
    title: "Seuil 3 × 8 min",
    objective: "threshold",
    segments: [{ sport: "run", steps: [warmup(min(15)), { repeat: 3, steps: [work(min(8), "threshold"), easy(min(2))] }, cooldown(min(10))] }],
  },
  {
    id: "run-tempo",
    sport: "run",
    label: "Tempo",
    title: "Tempo 2 × 15 min",
    objective: "tempo",
    segments: [{ sport: "run", steps: [warmup(min(15)), { repeat: 2, steps: [work(min(15), "tempo"), easy(min(3))] }, cooldown(min(10))] }],
  },
  { id: "run-long", sport: "run", label: "Sortie longue", title: "Sortie longue 1 h 30", objective: "endurance", segments: [{ sport: "run", steps: [work(min(90), "endurance", "Sortie longue")] }] },
  { id: "run-recovery", sport: "run", label: "Récupération", title: "Footing récupération 30 min", objective: "recovery", segments: [{ sport: "run", steps: [work(min(30), "recovery", "Footing très facile")] }] },
  // Vélo
  {
    id: "bike-endurance",
    sport: "bike",
    label: "Endurance",
    title: "Endurance 1 h 30",
    objective: "endurance",
    segments: [{ sport: "bike", steps: [warmup(min(10)), work(min(70), "endurance", "Endurance"), cooldown(min(10))] }],
  },
  {
    id: "bike-sweetspot",
    sport: "bike",
    label: "Sweet spot",
    title: "Sweet spot 3 × 12 min",
    objective: "tempo",
    segments: [{ sport: "bike", steps: [warmup(min(15)), { repeat: 3, steps: [work(min(12), "sweetspot"), easy(min(4))] }, cooldown(min(10))] }],
  },
  {
    id: "bike-threshold",
    sport: "bike",
    label: "Seuil",
    title: "Seuil 4 × 8 min",
    objective: "threshold",
    segments: [{ sport: "bike", steps: [warmup(min(15)), { repeat: 4, steps: [work(min(8), "threshold"), easy(min(3))] }, cooldown(min(10))] }],
  },
  {
    id: "bike-vo2",
    sport: "bike",
    label: "PMA",
    title: "PMA 5 × 4 min",
    objective: "vo2max",
    segments: [{ sport: "bike", steps: [warmup(min(15)), { repeat: 5, steps: [work(min(4), "vo2"), easy(min(4))] }, cooldown(min(10))] }],
  },
  { id: "bike-long", sport: "bike", label: "Sortie longue", title: "Sortie longue 3 h", objective: "endurance", segments: [{ sport: "bike", steps: [work(min(180), "endurance", "Sortie longue")] }] },
  { id: "bike-recovery", sport: "bike", label: "Récupération", title: "Vélo récupération 45 min", objective: "recovery", segments: [{ sport: "bike", steps: [work(min(45), "recovery", "Tourner les jambes")] }] },
  // Natation
  {
    id: "swim-endurance",
    sport: "swim",
    label: "Endurance",
    title: "Endurance 3 × 600 m",
    objective: "endurance",
    segments: [{ sport: "swim", steps: [warmup(m(400)), { repeat: 3, steps: [work(m(600), "endurance"), rest(sec(30))] }, cooldown(m(200))] }],
  },
  {
    id: "swim-technique",
    sport: "swim",
    label: "Technique",
    title: "Technique 8 × 50 m éducatifs",
    objective: "technique",
    segments: [
      {
        sport: "swim",
        steps: [
          warmup(m(300)),
          { repeat: 8, steps: [{ type: "drill", length: m(50), label: "Éducatif" }, rest(sec(15))] },
          { repeat: 4, steps: [work(m(100), "endurance", "Nage complète"), rest(sec(20))] },
          cooldown(m(200)),
        ],
      },
    ],
  },
  {
    id: "swim-css",
    sport: "swim",
    label: "CSS",
    title: "CSS 8 × 100 m",
    objective: "threshold",
    segments: [{ sport: "swim", steps: [warmup(m(400)), { repeat: 8, steps: [work(m(100), "threshold"), rest(sec(15))] }, cooldown(m(200))] }],
  },
  {
    id: "swim-speed",
    sport: "swim",
    label: "Vitesse",
    title: "Vitesse 10 × 50 m",
    objective: "vo2max",
    segments: [{ sport: "swim", steps: [warmup(m(400)), { repeat: 10, steps: [work(m(50), "vo2"), rest(sec(30))] }, cooldown(m(200))] }],
  },
  // Renforcement
  {
    id: "strength-circuit",
    sport: "strength",
    label: "Circuit",
    title: "Renforcement 3 tours",
    objective: "strength",
    segments: [
      {
        sport: "strength",
        steps: [
          warmup(min(10)),
          {
            repeat: 3,
            steps: [work(reps(15), "tempo", "Squats"), work(reps(12), "tempo", "Fentes, par jambe"), work(reps(10), "tempo", "Pompes"), work(sec(45), "tempo", "Gainage"), rest(sec(90))],
          },
          cooldown(min(5)),
        ],
      },
    ],
  },
  {
    id: "strength-core",
    sport: "strength",
    label: "Gainage",
    title: "Gainage 15 min",
    objective: "strength",
    segments: [
      {
        sport: "strength",
        steps: [
          {
            repeat: 3,
            steps: [
              work(sec(45), "tempo", "Planche"),
              work(sec(30), "tempo", "Planche latérale, côté droit"),
              work(sec(30), "tempo", "Planche latérale, côté gauche"),
              work(sec(45), "tempo", "Pont fessier"),
              rest(sec(60)),
            ],
          },
        ],
      },
    ],
  },
  // Enchaînement
  {
    id: "brick-standard",
    sport: "brick",
    label: "Enchaînement",
    title: "Enchaînement 1 h vélo + 20 min CAP",
    objective: "race_pace",
    segments: [
      { sport: "bike", steps: [warmup(min(10)), work(min(50), "tempo")] },
      { sport: "run", steps: [{ type: "transition", length: min(2) }, work(min(20), "tempo")] },
    ],
  },
  {
    id: "brick-long",
    sport: "brick",
    label: "Enchaînement long",
    title: "Enchaînement 2 h 30 vélo + 45 min CAP",
    objective: "endurance",
    segments: [
      { sport: "bike", steps: [warmup(min(15)), work(min(135), "endurance")] },
      { sport: "run", steps: [{ type: "transition", length: min(2) }, work(min(45), "endurance")] },
    ],
  },
];

/** Séances types d’une discipline, dans l’ordre d’affichage. */
export function startersFor(sport: SessionSport): Starter[] {
  return STARTERS.filter((starter) => starter.sport === sport);
}

export function starterById(id: string): Starter | undefined {
  return STARTERS.find((starter) => starter.id === id);
}

/** Le déroulé d’une séance type, avec les cibles adaptées aux seuils de l’athlète. */
export function buildStarter(starter: Starter, thresholds?: AthleteThresholds): Workout {
  const taken = new Set<string>();
  const toNode = (spec: Spec, sport: SegmentSport): WorkoutNode => {
    if ("repeat" in spec) return { kind: "repeat", id: newId("rp", taken), count: spec.repeat, steps: spec.steps.map((s) => toNode(s, sport)) };
    const target = spec.effort ? effortTarget(sport, spec.effort, thresholds) : defaultTarget(sport, spec.type, thresholds);
    const step: Step = { kind: "step", id: newId("st", taken), type: spec.type, length: spec.length, targets: target ? [target] : [] };
    return spec.label ? { ...step, label: spec.label } : step;
  };
  return {
    schemaVersion: 1,
    segments: starter.segments.map((segment) => ({ id: newId("sg", taken), sport: segment.sport, steps: segment.steps.map((spec) => toNode(spec, segment.sport)) })),
  };
}

/** La séance type dont le déroulé est encore intact (rien de réglé depuis), ou null. */
export function matchingStarter(workout: Workout, sport: SessionSport, thresholds?: AthleteThresholds): Starter | null {
  const shape = workoutShape(workout);
  return startersFor(sport).find((starter) => workoutShape(buildStarter(starter, thresholds)) === shape) ?? null;
}

/** Titres proposés par les séances types : un titre resté tel quel suit la séance type choisie. */
export const STARTER_TITLES: ReadonlySet<string> = new Set(STARTERS.map((starter) => starter.title));
