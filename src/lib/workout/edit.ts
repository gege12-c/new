/**
 * Opérations d’édition sur une séance (format v1), sans effet de bord : chaque fonction
 * renvoie un nouveau document. Un emplacement de bloc est un chemin :
 * [indice du segment, indice dans la liste, indice dans la répétition, …].
 */
import {
  LIMITS,
  TARGET_BOUNDS,
  type Length,
  type Repeat,
  type SegmentSport,
  type SessionSport,
  type Step,
  type StepType,
  type Target,
  type Workout,
  type WorkoutNode,
} from "./schema";
import type { AthleteThresholds } from "./zones";

export type NodePath = readonly number[];

function randomPart() {
  return Math.random().toString(36).slice(2, 8);
}

/** Identifiant de bloc unique dans le document. */
export function newId(prefix: string, taken: Set<string> = new Set()): string {
  for (;;) {
    const id = `${prefix}-${randomPart()}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export function collectIds(workout: Workout): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: WorkoutNode[]) => {
    for (const node of nodes) {
      ids.add(node.id);
      if (node.kind === "repeat") walk(node.steps);
    }
  };
  for (const segment of workout.segments) {
    ids.add(segment.id);
    walk(segment.steps);
  }
  return ids;
}

const minutes = (n: number): Length => ({ unit: "time", seconds: Math.round(n * 60) });
const meters = (n: number): Length => ({ unit: "distance", meters: n });

/** Intensité par type d’étape, dans l’unité de chaque famille de cibles. */
type Bands = Record<StepType, readonly [number, number]>;
const POWER_BANDS: Bands = { warmup: [55, 70], active: [88, 95], recovery: [45, 55], rest: [40, 50], cooldown: [50, 60], drill: [60, 75], transition: [55, 70] };
/** En % de la vitesse au seuil : l’échauffement reste nettement plus lent que l’allure seuil. */
const RUN_SPEED_BANDS: Bands = { warmup: [75, 82], active: [97, 102], recovery: [70, 78], rest: [65, 72], cooldown: [72, 80], drill: [80, 90], transition: [75, 82] };
const SWIM_SPEED_BANDS: Bands = { warmup: [80, 88], active: [95, 100], recovery: [75, 85], rest: [70, 80], cooldown: [75, 85], drill: [80, 88], transition: [80, 88] };
const LTHR_BANDS: Bands = { warmup: [70, 80], active: [90, 95], recovery: [65, 75], rest: [60, 70], cooldown: [65, 75], drill: [75, 85], transition: [70, 80] };
const MAX_HR_BANDS: Bands = { warmup: [62, 72], active: [82, 88], recovery: [58, 68], rest: [55, 65], cooldown: [58, 68], drill: [65, 75], transition: [62, 72] };
const ZONE_BANDS: Bands = { warmup: [2, 2], active: [4, 4], recovery: [1, 1], rest: [1, 1], cooldown: [1, 2], drill: [2, 3], transition: [2, 2] };
const RPE_BANDS: Bands = { warmup: [3, 4], active: [7, 8], recovery: [2, 3], rest: [1, 2], cooldown: [2, 3], drill: [3, 4], transition: [3, 4] };
const BIKE_SPEED_KMH: Bands = { warmup: [24, 27], active: [30, 33], recovery: [20, 23], rest: [15, 18], cooldown: [20, 23], drill: [25, 28], transition: [24, 27] };
const RUN_SPEED_KMH: Bands = { warmup: [9, 10], active: [12, 13], recovery: [8, 9], rest: [6, 7], cooldown: [8, 9], drill: [10, 11], transition: [9, 10] };

/**
 * Repères des valeurs de départ en unités absolues quand l’athlète n’a pas renseigné son seuil :
 * des valeurs plausibles à ajuster, jamais présentées comme calculées pour lui.
 */
const NOMINAL = { ftpW: 230, lthrBpm: 165, maxHrBpm: 185, thresholdPaceSPerKm: 300, cssSPer100m: 105 };

function clampTo(key: string, value: number): number {
  const bounds = TARGET_BOUNDS[key];
  return bounds ? Math.min(Math.max(value, bounds[0]), bounds[1]) : value;
}

/**
 * Valeurs d’une cible pour un type d’étape : un échauffement, une récupération et un bloc de
 * travail ne reçoivent pas la même intensité. Les unités absolues se déduisent des seuils de
 * l’athlète quand il les a renseignés.
 */
export function targetForStep(key: string, sport: SegmentSport, type: StepType, thresholds?: AthleteThresholds): Target {
  const [metric, unit] = key.split(".") as [Target["metric"], Target["unit"]];
  const scale = (base: number, [lo, hi]: readonly [number, number]): [number, number] => [Math.round((base * lo) / 100), Math.round((base * hi) / 100)];
  // Allure : la vitesse en % du seuil devient une durée au kilomètre (ou aux 100 m) plus courte quand elle augmente.
  const pace = (base: number, [lo, hi]: readonly [number, number]): [number, number] => [Math.round((base * 100) / hi), Math.round((base * 100) / lo)];
  const lthr = (sport === "run" ? thresholds?.run?.lthrBpm : thresholds?.bike?.lthrBpm) ?? NOMINAL.lthrBpm;
  let values: [number, number];
  switch (key) {
    case "power.watts":
      values = scale(thresholds?.bike?.ftpW ?? NOMINAL.ftpW, POWER_BANDS[type]);
      break;
    case "power.percent_ftp":
      values = [...POWER_BANDS[type]];
      break;
    case "heart_rate.bpm":
      values = scale(lthr, LTHR_BANDS[type]);
      break;
    case "heart_rate.percent_lthr":
      values = [...LTHR_BANDS[type]];
      break;
    case "heart_rate.percent_max_hr":
      values = [...MAX_HR_BANDS[type]];
      break;
    case "pace.sec_per_km":
      values = pace(thresholds?.run?.thresholdPaceSPerKm ?? NOMINAL.thresholdPaceSPerKm, RUN_SPEED_BANDS[type]);
      break;
    case "pace.sec_per_100m":
      values = pace(thresholds?.swim?.cssSPer100m ?? NOMINAL.cssSPer100m, SWIM_SPEED_BANDS[type]);
      break;
    case "pace.percent_threshold":
      values = [...(sport === "swim" ? SWIM_SPEED_BANDS : RUN_SPEED_BANDS)[type]];
      break;
    case "power.zone":
    case "heart_rate.zone":
    case "pace.zone":
      values = [...ZONE_BANDS[type]];
      break;
    case "speed.kmh":
      values = [...(sport === "run" ? RUN_SPEED_KMH : BIKE_SPEED_KMH)[type]];
      break;
    case "cadence.rpm":
      values = type === "active" ? [85, 95] : [80, 90];
      break;
    case "cadence.spm":
      values = type === "active" ? [172, 182] : [165, 175];
      break;
    case "rpe.scale":
      values = [...RPE_BANDS[type]];
      break;
    default:
      values = [TARGET_BOUNDS[key]?.[0] ?? 0, TARGET_BOUNDS[key]?.[0] ?? 0];
  }
  const [min, max] = values.map((v) => clampTo(key, v)).sort((a, b) => a - b);
  return { metric, unit, min, max };
}

/**
 * Cible par défaut d’une étape. Sans athlète (modèle de la bibliothèque), relative aux seuils :
 * elle s’adapte à chacun. Pour un athlète, relative au seuil qu’il a renseigné ; sans ce seuil,
 * l’effort ressenti (RPE), qui se passe de tout seuil. Le vélo garde le % de FTP : compteurs et
 * Zwift appliquent leur propre FTP.
 */
export function defaultTarget(sport: SegmentSport, type: StepType, thresholds?: AthleteThresholds): Target | null {
  if (type === "rest" || type === "drill" || type === "transition") return null;
  const template = thresholds === undefined;
  if (sport === "bike") return targetForStep("power.percent_ftp", sport, type, thresholds);
  if (sport === "run" && (template || thresholds?.run?.thresholdPaceSPerKm)) return targetForStep("pace.percent_threshold", sport, type, thresholds);
  if (sport === "swim" && (template || thresholds?.swim?.cssSPer100m)) return targetForStep("pace.percent_threshold", sport, type, thresholds);
  return targetForStep("rpe.scale", sport, type, thresholds);
}

/**
 * Nouveau type d’une étape : les cibles restées à leur valeur de départ suivent le nouveau type
 * (une récupération ne garde pas l’intensité d’un bloc de travail) ; celles que l’on a réglées
 * restent telles quelles.
 */
export function retargetForType(step: Step, type: StepType, sport: SegmentSport, thresholds?: AthleteThresholds): Target[] {
  return step.targets.map((target) => {
    const key = `${target.metric}.${target.unit}`;
    const before = targetForStep(key, sport, step.type, thresholds);
    return before.min === target.min && before.max === target.max ? targetForStep(key, sport, type, thresholds) : target;
  });
}

/** Durée ou distance par défaut d’une étape. */
export function defaultLength(sport: SegmentSport, type: StepType): Length {
  if (sport === "swim") {
    const swim: Record<StepType, Length> = {
      warmup: meters(400),
      active: meters(100),
      recovery: meters(50),
      rest: minutes(0.5),
      cooldown: meters(200),
      drill: meters(50),
      transition: minutes(2),
    };
    return swim[type];
  }
  if (sport === "strength") {
    if (type === "active") return { unit: "reps", reps: 12 };
    if (type === "rest") return minutes(1.5);
  }
  const time: Record<StepType, number> = {
    warmup: 15,
    active: 10,
    recovery: 3,
    rest: 2,
    cooldown: 10,
    drill: 5,
    transition: 2,
  };
  return minutes(time[type]);
}

export function makeStep(sport: SegmentSport, type: StepType, taken: Set<string>, thresholds?: AthleteThresholds): Step {
  const target = defaultTarget(sport, type, thresholds);
  return { kind: "step", id: newId("st", taken), type, length: defaultLength(sport, type), targets: target ? [target] : [] };
}

export function makeRepeat(sport: SegmentSport, taken: Set<string>, count = 4, thresholds?: AthleteThresholds): Repeat {
  return {
    kind: "repeat",
    id: newId("rp", taken),
    count,
    steps: [makeStep(sport, "active", taken, thresholds), makeStep(sport, "recovery", taken, thresholds)],
  };
}

/** Séance de départ pour une discipline : échauffement, corps de séance, retour au calme. */
export function defaultWorkout(sport: SessionSport, thresholds?: AthleteThresholds): Workout {
  const taken = new Set<string>();
  const segment = (segmentSport: SegmentSport, steps: WorkoutNode[]) => ({ id: newId("sg", taken), sport: segmentSport, steps });
  const step = (segmentSport: SegmentSport, type: StepType) => makeStep(segmentSport, type, taken, thresholds);
  if (sport === "brick") {
    return {
      schemaVersion: 1,
      segments: [
        segment("bike", [step("bike", "warmup"), { ...step("bike", "active"), length: minutes(45) }]),
        segment("run", [step("run", "transition"), { ...step("run", "active"), length: minutes(20) }]),
      ],
    };
  }
  const main: WorkoutNode = makeRepeat(sport, taken, sport === "strength" ? 3 : 4, thresholds);
  return {
    schemaVersion: 1,
    segments: [segment(sport, [step(sport, "warmup"), main, step(sport, "cooldown")])],
  };
}

/** Contenu sans ses identifiants : deux séances de même forme se comparent ainsi. */
function shapeOf(workout: Workout): string {
  return JSON.stringify(workout, (key, value) => (key === "id" ? undefined : value));
}

/** La séance est-elle encore celle proposée au départ pour cette discipline (rien n’a été modifié) ? */
export function isDefaultWorkout(workout: Workout, sport: SessionSport, thresholds?: AthleteThresholds): boolean {
  return shapeOf(workout) === shapeOf(defaultWorkout(sport, thresholds));
}

// ---------------------------------------------------------------------------
// Navigation dans l’arbre
// ---------------------------------------------------------------------------

function listAt(workout: Workout, parent: NodePath): WorkoutNode[] {
  const [segmentIndex, ...rest] = parent;
  let list = workout.segments[segmentIndex]?.steps;
  for (const index of rest) {
    const node = list?.[index];
    if (!node || node.kind !== "repeat") throw new Error("Chemin invalide");
    list = node.steps;
  }
  if (!list) throw new Error("Chemin invalide");
  return list;
}

export function nodeAt(workout: Workout, path: NodePath): WorkoutNode {
  const node = listAt(workout, path.slice(0, -1))[path[path.length - 1]];
  if (!node) throw new Error("Chemin invalide");
  return node;
}

/** Remplace la liste désignée par `parent` (chemin vers une liste) par le résultat de `update`. */
function withList(workout: Workout, parent: NodePath, update: (list: WorkoutNode[]) => WorkoutNode[]): Workout {
  const [segmentIndex, ...rest] = parent;
  const rebuild = (list: WorkoutNode[], depth: number): WorkoutNode[] => {
    if (depth === rest.length) return update(list);
    const index = rest[depth];
    return list.map((node, i) => {
      if (i !== index) return node;
      if (node.kind !== "repeat") throw new Error("Chemin invalide");
      return { ...node, steps: rebuild(node.steps, depth + 1) };
    });
  };
  return {
    ...workout,
    segments: workout.segments.map((segment, i) => (i === segmentIndex ? { ...segment, steps: rebuild(segment.steps, 0) } : segment)),
  };
}

/** Nombre de répétitions qui englobent le bloc (0 = au premier niveau). */
export function repeatDepth(path: NodePath): number {
  return Math.max(path.length - 2, 0);
}

// ---------------------------------------------------------------------------
// Opérations
// ---------------------------------------------------------------------------

export function updateNode(workout: Workout, path: NodePath, update: (node: WorkoutNode) => WorkoutNode): Workout {
  const index = path[path.length - 1];
  return withList(workout, path.slice(0, -1), (list) => list.map((node, i) => (i === index ? update(node) : node)));
}

export function updateStep(workout: Workout, path: NodePath, patch: Partial<Omit<Step, "kind" | "id">>): Workout {
  return updateNode(workout, path, (node) => (node.kind === "step" ? { ...node, ...patch } : node));
}

export function insertNode(workout: Workout, parent: NodePath, index: number, node: WorkoutNode): Workout {
  return withList(workout, parent, (list) => {
    if (list.length >= LIMITS.maxNodesPerList) return list;
    const copy = [...list];
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, node);
    return copy;
  });
}

export function appendNode(workout: Workout, parent: NodePath, node: WorkoutNode): Workout {
  return insertNode(workout, parent, Number.MAX_SAFE_INTEGER, node);
}

/** Supprime un bloc ; une répétition vidée disparaît avec lui. Le dernier bloc d’un segment reste. */
export function removeNode(workout: Workout, path: NodePath): Workout {
  const parent = path.slice(0, -1);
  const list = listAt(workout, parent);
  if (list.length === 1) {
    if (parent.length === 1) return workout;
    return removeNode(workout, parent);
  }
  const index = path[path.length - 1];
  return withList(workout, parent, (items) => items.filter((_, i) => i !== index));
}

export function moveNode(workout: Workout, path: NodePath, delta: -1 | 1): Workout {
  const index = path[path.length - 1];
  const target = index + delta;
  return withList(workout, path.slice(0, -1), (list) => {
    if (target < 0 || target >= list.length) return list;
    const copy = [...list];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  });
}

function cloneNode(node: WorkoutNode, taken: Set<string>): WorkoutNode {
  if (node.kind === "repeat") {
    return { ...node, id: newId("rp", taken), steps: node.steps.map((child) => cloneNode(child, taken)) };
  }
  return { ...node, id: newId("st", taken), targets: node.targets.map((t) => ({ ...t })) };
}

export function duplicateNode(workout: Workout, path: NodePath): Workout {
  const taken = collectIds(workout);
  const copy = cloneNode(nodeAt(workout, path), taken);
  return insertNode(workout, path.slice(0, -1), path[path.length - 1] + 1, copy);
}

/** Niveaux de répétitions contenus dans un bloc, lui compris (0 pour une étape). */
export function innerDepth(node: WorkoutNode): number {
  if (node.kind === "step") return 0;
  return 1 + Math.max(0, ...node.steps.map(innerDepth));
}

/** Vrai si le bloc peut être placé dans une nouvelle répétition sans dépasser la profondeur maximale. */
export function canWrapInRepeat(workout: Workout, path: NodePath): boolean {
  return repeatDepth(path) + 1 + innerDepth(nodeAt(workout, path)) <= LIMITS.maxRepeatDepth;
}

/** Place un bloc dans une nouvelle répétition (× 2), si la profondeur maximale le permet. */
export function wrapInRepeat(workout: Workout, path: NodePath): Workout {
  if (!canWrapInRepeat(workout, path)) return workout;
  const taken = collectIds(workout);
  return updateNode(workout, path, (node) => ({ kind: "repeat", id: newId("rp", taken), count: 2, steps: [node] }));
}

/** Remplace une répétition par son contenu, déroulé une seule fois. */
export function unwrapRepeat(workout: Workout, path: NodePath): Workout {
  const node = nodeAt(workout, path);
  if (node.kind !== "repeat") return workout;
  const index = path[path.length - 1];
  return withList(workout, path.slice(0, -1), (list) => [...list.slice(0, index), ...node.steps, ...list.slice(index + 1)]);
}

export function addSegment(workout: Workout, sport: SegmentSport, thresholds?: AthleteThresholds): Workout {
  if (workout.segments.length >= LIMITS.maxSegments) return workout;
  const taken = collectIds(workout);
  const steps: WorkoutNode[] =
    workout.segments.length > 0
      ? [makeStep(sport, "transition", taken, thresholds), { ...makeStep(sport, "active", taken, thresholds), length: minutes(20) }]
      : [makeStep(sport, "active", taken, thresholds)];
  return { ...workout, segments: [...workout.segments, { id: newId("sg", taken), sport, steps }] };
}

export function removeSegment(workout: Workout, index: number): Workout {
  if (workout.segments.length <= 1) return workout;
  return { ...workout, segments: workout.segments.filter((_, i) => i !== index) };
}

export function moveSegment(workout: Workout, index: number, delta: -1 | 1): Workout {
  const target = index + delta;
  if (target < 0 || target >= workout.segments.length) return workout;
  const segments = [...workout.segments];
  [segments[index], segments[target]] = [segments[target], segments[index]];
  return { ...workout, segments };
}

/**
 * Change la discipline d’un segment. Les cibles devenues impossibles (une puissance en natation…)
 * sont retirées et comptées : l’interface prévient le coach, rien n’est converti en silence.
 */
export function setSegmentSport(
  workout: Workout,
  index: number,
  sport: SegmentSport,
  allowed: (sport: SegmentSport, key: string) => boolean,
): { workout: Workout; removedTargets: number } {
  let removedTargets = 0;
  const fix = (nodes: WorkoutNode[]): WorkoutNode[] =>
    nodes.map((node) => {
      if (node.kind === "repeat") return { ...node, steps: fix(node.steps) };
      const targets = node.targets.filter((t) => allowed(sport, `${t.metric}.${t.unit}`));
      removedTargets += node.targets.length - targets.length;
      const { sendOffSeconds, ...rest } = node;
      if (sendOffSeconds !== undefined && sport !== "swim") return { ...rest, targets };
      return { ...node, targets };
    });
  return {
    workout: {
      ...workout,
      segments: workout.segments.map((segment, i) => (i === index ? { ...segment, sport, steps: fix(segment.steps) } : segment)),
    },
    removedTargets,
  };
}
