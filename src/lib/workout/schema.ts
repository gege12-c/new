/**
 * Format interne des séances structurées (version 1).
 *
 * Une séance = un ou plusieurs segments (un par discipline pour un enchaînement),
 * chaque segment = une liste d’étapes et de répétitions (imbriquables).
 * Ce format est indépendant des fournisseurs : les exports (.zwo, FIT…) le convertissent.
 * Toute évolution incompatible doit incrémenter `schemaVersion` et fournir une migration.
 */
import { z } from "zod";

export const WORKOUT_SCHEMA_VERSION = 1 as const;

/** Disciplines d’un segment. */
export const SEGMENT_SPORTS = ["swim", "bike", "run", "strength", "other"] as const;
export type SegmentSport = (typeof SEGMENT_SPORTS)[number];

/** Discipline d’une séance : celle de ses segments, ou "brick" s’ils diffèrent. */
export const SESSION_SPORTS = [...SEGMENT_SPORTS, "brick"] as const;
export type SessionSport = (typeof SESSION_SPORTS)[number];

export const STEP_TYPES = [
  "warmup",
  "active",
  "recovery",
  "rest",
  "cooldown",
  "drill",
  "transition",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const EQUIPMENT = [
  "pull_buoy",
  "paddles",
  "fins",
  "snorkel",
  "kickboard",
  "band",
  "tempo_trainer",
  "home_trainer",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Objectif physiologique d’une séance (aussi contrôlé en base). */
export const SESSION_OBJECTIVES = [
  "recovery",
  "endurance",
  "tempo",
  "threshold",
  "vo2max",
  "anaerobic",
  "sprint",
  "technique",
  "race_pace",
  "strength",
  "test",
  "race",
  "other",
] as const;
export type SessionObjective = (typeof SESSION_OBJECTIVES)[number];

export const LIMITS = {
  maxSegments: 6,
  maxNodesPerList: 200,
  maxNodes: 300,
  maxExpandedSteps: 2000,
  maxRepeatCount: 100,
  maxRepeatDepth: 3,
  maxStepSeconds: 12 * 3600,
  maxStepMeters: 300_000,
  maxReps: 1000,
  maxTargetsPerStep: 2,
  maxText: 2000,
} as const;

export const TARGET_METRICS = ["power", "heart_rate", "pace", "speed", "cadence", "rpe"] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

export const TARGET_UNITS = [
  "watts",
  "percent_ftp",
  "bpm",
  "percent_lthr",
  "percent_max_hr",
  "sec_per_km",
  "sec_per_100m",
  "percent_threshold",
  "kmh",
  "rpm",
  "spm",
  "scale",
  "zone",
] as const;
export type TargetUnit = (typeof TARGET_UNITS)[number];

/**
 * Bornes plausibles par couple métrique.unité.
 * Allures : secondes par km ou par 100 m ; `min` = borne la plus rapide.
 * `percent_threshold` : pourcentage de la VITESSE au seuil (110 % = plus rapide que le seuil).
 */
export const TARGET_BOUNDS: Record<string, readonly [number, number]> = {
  "power.watts": [0, 2500],
  "power.percent_ftp": [0, 300],
  "power.zone": [1, 7],
  "heart_rate.bpm": [30, 230],
  "heart_rate.percent_lthr": [40, 130],
  "heart_rate.percent_max_hr": [40, 100],
  "heart_rate.zone": [1, 5],
  "pace.sec_per_km": [120, 1200],
  "pace.sec_per_100m": [45, 360],
  "pace.percent_threshold": [40, 130],
  "pace.zone": [1, 5],
  "speed.kmh": [1, 90],
  "cadence.rpm": [20, 200],
  "cadence.spm": [60, 240],
  "rpe.scale": [1, 10],
};

/** Couples métrique.unité acceptés par discipline. */
export const SPORT_TARGETS: Record<SegmentSport, readonly string[]> = {
  bike: [
    "power.watts",
    "power.percent_ftp",
    "power.zone",
    "heart_rate.bpm",
    "heart_rate.percent_lthr",
    "heart_rate.percent_max_hr",
    "heart_rate.zone",
    "speed.kmh",
    "cadence.rpm",
    "rpe.scale",
  ],
  run: [
    "pace.sec_per_km",
    "pace.percent_threshold",
    "pace.zone",
    "speed.kmh",
    "power.watts",
    "heart_rate.bpm",
    "heart_rate.percent_lthr",
    "heart_rate.percent_max_hr",
    "heart_rate.zone",
    "cadence.spm",
    "rpe.scale",
  ],
  swim: [
    "pace.sec_per_100m",
    "pace.percent_threshold",
    "pace.zone",
    "heart_rate.bpm",
    "heart_rate.percent_max_hr",
    "rpe.scale",
  ],
  strength: ["heart_rate.bpm", "heart_rate.percent_max_hr", "rpe.scale"],
  other: ["heart_rate.bpm", "heart_rate.percent_max_hr", "power.watts", "speed.kmh", "rpe.scale"],
};

const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide");

const shortText = (max: number) => z.string().trim().max(max);

export const LengthSchema = z.discriminatedUnion("unit", [
  z.strictObject({
    unit: z.literal("time"),
    seconds: z.int().min(1).max(LIMITS.maxStepSeconds),
  }),
  z.strictObject({
    unit: z.literal("distance"),
    meters: z.number().min(1).max(LIMITS.maxStepMeters),
  }),
  z.strictObject({
    unit: z.literal("reps"),
    reps: z.int().min(1).max(LIMITS.maxReps),
  }),
  /** Durée libre : l’étape se termine à l’appui sur le bouton tour. */
  z.strictObject({ unit: z.literal("open") }),
]);

export const TargetSchema = z
  .strictObject({
    metric: z.enum(TARGET_METRICS),
    unit: z.enum(TARGET_UNITS),
    min: z.number(),
    max: z.number(),
  })
  .superRefine((t, ctx) => {
    const bounds = TARGET_BOUNDS[`${t.metric}.${t.unit}`];
    if (!bounds) {
      ctx.addIssue({
        code: "custom",
        message: `L’unité « ${t.unit} » n’existe pas pour la métrique « ${t.metric} ».`,
        path: ["unit"],
      });
      return;
    }
    if (t.min > t.max) {
      ctx.addIssue({
        code: "custom",
        message: "La borne basse dépasse la borne haute.",
        path: ["min"],
      });
    }
    if (t.min < bounds[0] || t.max > bounds[1]) {
      ctx.addIssue({
        code: "custom",
        message: `Valeur hors limites (${bounds[0]} à ${bounds[1]}).`,
        path: ["max"],
      });
    }
    if ((t.unit === "zone" || t.unit === "scale") && (!Number.isInteger(t.min) || !Number.isInteger(t.max))) {
      ctx.addIssue({
        code: "custom",
        message: "Les zones et le RPE s’expriment en nombres entiers.",
        path: ["min"],
      });
    }
  });

export const StepSchema = z
  .strictObject({
    kind: z.literal("step"),
    id: IdSchema,
    type: z.enum(STEP_TYPES),
    length: LengthSchema,
    targets: z.array(TargetSchema).max(LIMITS.maxTargetsPerStep).default([]),
    label: shortText(80).optional(),
    notes: shortText(LIMITS.maxText).optional(),
    equipment: z.array(z.enum(EQUIPMENT)).max(EQUIPMENT.length).optional(),
    /** Natation : départ toutes les N secondes (effort + récupération compris). */
    sendOffSeconds: z.int().min(10).max(3600).optional(),
  })
  .superRefine((s, ctx) => {
    const metrics = s.targets.map((t) => t.metric);
    if (new Set(metrics).size !== metrics.length) {
      ctx.addIssue({
        code: "custom",
        message: "Deux cibles d’une même étape ne peuvent pas porter sur la même métrique.",
        path: ["targets"],
      });
    }
    if (s.sendOffSeconds !== undefined && s.length.unit !== "distance") {
      ctx.addIssue({
        code: "custom",
        message: "Un départ (send-off) s’applique à une étape en distance.",
        path: ["sendOffSeconds"],
      });
    }
  });

export type Step = z.infer<typeof StepSchema>;
export type StepInput = z.input<typeof StepSchema>;
export type Repeat = {
  kind: "repeat";
  id: string;
  count: number;
  label?: string;
  steps: WorkoutNode[];
};
export type RepeatInput = Omit<Repeat, "steps"> & { steps: WorkoutNodeInput[] };
export type WorkoutNode = Step | Repeat;
export type WorkoutNodeInput = StepInput | RepeatInput;

export const RepeatSchema: z.ZodType<Repeat, RepeatInput> = z.lazy(() =>
  z.strictObject({
    kind: z.literal("repeat"),
    id: IdSchema,
    count: z.int().min(1).max(LIMITS.maxRepeatCount),
    label: shortText(80).optional(),
    steps: z.array(NodeSchema).min(1).max(LIMITS.maxNodesPerList),
  }),
);

export const NodeSchema: z.ZodType<WorkoutNode, WorkoutNodeInput> = z.lazy(() =>
  z.union([StepSchema, RepeatSchema]),
);

export const SegmentSchema = z.strictObject({
  id: IdSchema,
  sport: z.enum(SEGMENT_SPORTS),
  title: shortText(120).optional(),
  goal: shortText(500).optional(),
  steps: z.array(NodeSchema).min(1).max(LIMITS.maxNodesPerList),
});
export type Segment = z.infer<typeof SegmentSchema>;

type StructureStats = { nodes: number; expanded: number; maxDepth: number; ids: string[] };

function collectStats(nodes: WorkoutNode[], depth: number, multiplier: number, acc: StructureStats) {
  for (const node of nodes) {
    acc.nodes += 1;
    acc.ids.push(node.id);
    if (node.kind === "repeat") {
      acc.maxDepth = Math.max(acc.maxDepth, depth + 1);
      collectStats(node.steps, depth + 1, multiplier * node.count, acc);
    } else {
      acc.expanded += multiplier;
    }
  }
}

export const WorkoutSchema = z
  .strictObject({
    schemaVersion: z.literal(WORKOUT_SCHEMA_VERSION),
    segments: z.array(SegmentSchema).min(1).max(LIMITS.maxSegments),
  })
  .superRefine((w, ctx) => {
    const stats: StructureStats = { nodes: 0, expanded: 0, maxDepth: 0, ids: [] };
    w.segments.forEach((segment, segmentIndex) => {
      stats.ids.push(segment.id);
      collectStats(segment.steps, 0, 1, stats);
      checkTargetsForSport(segment.steps, segment.sport, ["segments", segmentIndex, "steps"], ctx);
    });
    if (stats.maxDepth > LIMITS.maxRepeatDepth) {
      ctx.addIssue({
        code: "custom",
        message: `Pas plus de ${LIMITS.maxRepeatDepth} niveaux de répétitions imbriquées.`,
        path: ["segments"],
      });
    }
    if (stats.nodes > LIMITS.maxNodes) {
      ctx.addIssue({
        code: "custom",
        message: `Séance trop longue : ${stats.nodes} blocs (maximum ${LIMITS.maxNodes}).`,
        path: ["segments"],
      });
    }
    if (stats.expanded > LIMITS.maxExpandedSteps) {
      ctx.addIssue({
        code: "custom",
        message: `Séance trop longue une fois les répétitions déroulées (${stats.expanded} étapes, maximum ${LIMITS.maxExpandedSteps}).`,
        path: ["segments"],
      });
    }
    if (new Set(stats.ids).size !== stats.ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Chaque bloc doit avoir un identifiant unique.",
        path: ["segments"],
      });
    }
  });

function checkTargetsForSport(
  nodes: WorkoutNode[],
  sport: SegmentSport,
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  const allowed = SPORT_TARGETS[sport];
  nodes.forEach((node, index) => {
    if (node.kind === "repeat") {
      checkTargetsForSport(node.steps, sport, [...path, index, "steps"], ctx);
      return;
    }
    node.targets.forEach((target, targetIndex) => {
      const key = `${target.metric}.${target.unit}`;
      if (TARGET_BOUNDS[key] && !allowed.includes(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Cible « ${key} » non disponible en ${SPORT_LABELS[sport].toLowerCase()}.`,
          path: [...path, index, "targets", targetIndex],
        });
      }
    });
    if (node.sendOffSeconds !== undefined && sport !== "swim") {
      ctx.addIssue({
        code: "custom",
        message: "Les départs (send-off) sont réservés à la natation.",
        path: [...path, index, "sendOffSeconds"],
      });
    }
  });
}

export type Workout = z.infer<typeof WorkoutSchema>;
export type WorkoutInput = z.input<typeof WorkoutSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type Length = z.infer<typeof LengthSchema>;

export const SPORT_LABELS: Record<SessionSport, string> = {
  swim: "Natation",
  bike: "Vélo",
  run: "Course à pied",
  strength: "Renforcement",
  other: "Autre",
  brick: "Enchaînement",
};

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  warmup: "Échauffement",
  active: "Travail",
  recovery: "Récupération",
  rest: "Repos",
  cooldown: "Retour au calme",
  drill: "Éducatifs",
  transition: "Transition",
};

export const OBJECTIVE_LABELS: Record<SessionObjective, string> = {
  recovery: "Récupération",
  endurance: "Endurance",
  tempo: "Tempo",
  threshold: "Seuil",
  vo2max: "VO2max",
  anaerobic: "Anaérobie",
  sprint: "Sprint",
  technique: "Technique",
  race_pace: "Allure course",
  strength: "Force",
  test: "Test",
  race: "Compétition",
  other: "Autre",
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  pull_buoy: "Pull-buoy",
  paddles: "Plaquettes",
  fins: "Palmes",
  snorkel: "Tuba frontal",
  kickboard: "Planche",
  band: "Élastique",
  tempo_trainer: "Tempo trainer",
  home_trainer: "Home trainer",
  other: "Autre",
};

/** Discipline d’une séance déduite de ses segments. */
export function sessionSportOf(workout: Pick<Workout, "segments">): SessionSport {
  const sports = new Set(workout.segments.map((s) => s.sport));
  if (sports.size === 1) return workout.segments[0].sport;
  return "brick";
}

/** Valide une séance ; renvoie la séance normalisée ou la liste des erreurs. */
export function parseWorkout(input: unknown):
  | { success: true; data: Workout }
  | { success: false; errors: { path: string; message: string }[] } {
  const result = WorkoutSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}
