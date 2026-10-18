/**
 * Opérations d’édition sur une séance (format v1), sans effet de bord : chaque fonction
 * renvoie un nouveau document. Un emplacement de bloc est un chemin :
 * [indice du segment, indice dans la liste, indice dans la répétition, …].
 */
import {
  LIMITS,
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

/** Cible par défaut d’une étape, exprimée relativement aux seuils (s’adapte à chaque athlète). */
export function defaultTarget(sport: SegmentSport, type: StepType): Target | null {
  const band: Record<StepType, [number, number] | null> = {
    warmup: [55, 70],
    active: [88, 95],
    recovery: [45, 55],
    rest: null,
    cooldown: [50, 60],
    drill: null,
    transition: null,
  };
  const range = band[type];
  if (!range) return null;
  if (sport === "bike") return { metric: "power", unit: "percent_ftp", min: range[0], max: range[1] };
  if (sport === "run" || sport === "swim") {
    // En % de la vitesse au seuil : l’échauffement reste nettement plus lent que l’allure seuil.
    const speed: Record<string, [number, number]> = {
      warmup: [75, 82],
      active: [97, 102],
      recovery: [70, 78],
      cooldown: [72, 80],
    };
    const [min, max] = speed[type] ?? range;
    return { metric: "pace", unit: "percent_threshold", min, max };
  }
  if (sport === "strength" || sport === "other") {
    const rpe: Record<string, [number, number]> = { warmup: [2, 3], active: [6, 7], recovery: [2, 3], cooldown: [1, 2] };
    const [min, max] = rpe[type] ?? [3, 4];
    return { metric: "rpe", unit: "scale", min, max };
  }
  return null;
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

export function makeStep(sport: SegmentSport, type: StepType, taken: Set<string>): Step {
  const target = defaultTarget(sport, type);
  return { kind: "step", id: newId("st", taken), type, length: defaultLength(sport, type), targets: target ? [target] : [] };
}

export function makeRepeat(sport: SegmentSport, taken: Set<string>, count = 4): Repeat {
  return {
    kind: "repeat",
    id: newId("rp", taken),
    count,
    steps: [makeStep(sport, "active", taken), makeStep(sport, "recovery", taken)],
  };
}

/** Séance de départ pour une discipline : échauffement, corps de séance, retour au calme. */
export function defaultWorkout(sport: SessionSport): Workout {
  const taken = new Set<string>();
  const segment = (segmentSport: SegmentSport, steps: WorkoutNode[]) => ({ id: newId("sg", taken), sport: segmentSport, steps });
  if (sport === "brick") {
    return {
      schemaVersion: 1,
      segments: [
        segment("bike", [makeStep("bike", "warmup", taken), { ...makeStep("bike", "active", taken), length: minutes(45) }]),
        segment("run", [makeStep("run", "transition", taken), { ...makeStep("run", "active", taken), length: minutes(20) }]),
      ],
    };
  }
  const main: WorkoutNode = sport === "strength" ? makeRepeat(sport, taken, 3) : makeRepeat(sport, taken, 4);
  return {
    schemaVersion: 1,
    segments: [segment(sport, [makeStep(sport, "warmup", taken), main, makeStep(sport, "cooldown", taken)])],
  };
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

export function addSegment(workout: Workout, sport: SegmentSport): Workout {
  if (workout.segments.length >= LIMITS.maxSegments) return workout;
  const taken = collectIds(workout);
  const steps: WorkoutNode[] =
    workout.segments.length > 0
      ? [makeStep(sport, "transition", taken), { ...makeStep(sport, "active", taken), length: minutes(20) }]
      : [makeStep(sport, "active", taken)];
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
