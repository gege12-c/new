/**
 * Séances de démonstration pour la pile locale (données fictives de développement).
 * Écrites dans le format interne v1, comme le ferait l'éditeur.
 */
import type { StepType, Target, WorkoutInput, WorkoutNodeInput } from "@/lib/workout/schema";

let counter = 0;
const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

const time = (minutes: number) => ({ unit: "time" as const, seconds: Math.round(minutes * 60) });
const dist = (meters: number) => ({ unit: "distance" as const, meters });
const reps = (count: number) => ({ unit: "reps" as const, reps: count });

const ftp = (min: number, max: number): Target => ({ metric: "power", unit: "percent_ftp", min, max });
const pace = (min: number, max: number): Target => ({ metric: "pace", unit: "percent_threshold", min, max });
const cadence = (min: number, max: number): Target => ({ metric: "cadence", unit: "rpm", min, max });
const rpe = (min: number, max: number): Target => ({ metric: "rpe", unit: "scale", min, max });

function step(
  type: StepType,
  length: ReturnType<typeof time> | ReturnType<typeof dist> | ReturnType<typeof reps> | { unit: "open" },
  targets: Target[] = [],
  extra: Record<string, unknown> = {},
): WorkoutNodeInput {
  return { kind: "step", id: id("s"), type, length, targets, ...extra } as WorkoutNodeInput;
}

function repeat(count: number, steps: WorkoutNodeInput[], label?: string): WorkoutNodeInput {
  return { kind: "repeat", id: id("r"), count, steps, ...(label ? { label } : {}) };
}

function workout(sport: "swim" | "bike" | "run" | "strength", title: string, steps: WorkoutNodeInput[], goal?: string): WorkoutInput {
  return { schemaVersion: 1, segments: [{ id: id("seg"), sport, title, ...(goal ? { goal } : {}), steps }] };
}

export interface DemoSession {
  sport: "swim" | "bike" | "run" | "strength" | "brick";
  title: string;
  objective: string;
  description?: string;
  nutrition?: string;
  content: WorkoutInput;
}

export const DEMO: Record<string, () => DemoSession> = {
  bikeThreshold: () => ({
    sport: "bike",
    title: "Seuil 4 × 8 min",
    objective: "threshold",
    description: "Blocs réguliers, sans dépasser le haut de la plage. Cadence fluide.",
    nutrition: "Un bidon de boisson d'effort (60 g de glucides) pendant la séance.",
    content: workout("bike", "Seuil 4 × 8 min", [
      step("warmup", time(15), [ftp(55, 70)]),
      repeat(4, [step("active", time(8), [ftp(95, 100), cadence(85, 95)]), step("recovery", time(3), [ftp(45, 55)])]),
      step("cooldown", time(10), [ftp(50, 60)]),
    ]),
  }),
  bikeVo2: () => ({
    sport: "bike",
    title: "PMA 5 × 4 min",
    objective: "vo2max",
    description: "Partir prudemment sur le premier bloc : les derniers doivent rester dans la plage.",
    content: workout("bike", "PMA 5 × 4 min", [
      step("warmup", time(10), [ftp(55, 65)]),
      step("warmup", time(5), [ftp(70, 80)]),
      repeat(5, [step("active", time(4), [ftp(110, 118)]), step("recovery", time(4), [ftp(45, 55)])]),
      step("cooldown", time(10), [ftp(50, 60)]),
    ]),
  }),
  bikeSweetSpot: () => ({
    sport: "bike",
    title: "Sweet spot 3 × 12 min",
    objective: "tempo",
    content: workout("bike", "Sweet spot 3 × 12 min", [
      step("warmup", time(15), [ftp(55, 70)]),
      repeat(3, [step("active", time(12), [ftp(88, 93)]), step("recovery", time(4), [ftp(50, 55)])]),
      step("cooldown", time(8), [ftp(50, 60)]),
    ]),
  }),
  bikeLong: () => ({
    sport: "bike",
    title: "Sortie longue 3 h, 3 × 15 min tempo",
    objective: "endurance",
    description: "Parcours vallonné possible : rester en endurance dans les montées hors blocs.",
    nutrition: "70 à 80 g de glucides par heure, à partir de la 30e minute. Deux bidons.",
    content: workout("bike", "Sortie longue", [
      step("warmup", time(20), [ftp(55, 65)]),
      step("active", time(40), [ftp(65, 75)]),
      repeat(3, [step("active", time(15), [ftp(80, 86)]), step("recovery", time(10), [ftp(60, 70)])]),
      step("active", time(35), [ftp(65, 75)]),
      step("cooldown", time(10), [ftp(50, 60)]),
    ]),
  }),
  bikeEndurance: () => ({
    sport: "bike",
    title: "Endurance 1 h 30",
    objective: "endurance",
    content: workout("bike", "Endurance", [
      step("warmup", time(10), [ftp(50, 60)]),
      step("active", time(70), [ftp(65, 75), cadence(85, 95)]),
      step("cooldown", time(10), [ftp(50, 60)]),
    ]),
  }),
  runEasy: () => ({
    sport: "run",
    title: "Footing 45 min",
    objective: "endurance",
    content: workout("run", "Footing", [step("active", time(45), [pace(76, 84)])]),
  }),
  runThreshold: () => ({
    sport: "run",
    title: "Seuil 3 × 10 min",
    objective: "threshold",
    description: "Allure régulière, relâchement des épaules. Récupération en trottinant.",
    content: workout("run", "Seuil 3 × 10 min", [
      step("warmup", time(15), [pace(75, 82)]),
      step("drill", time(5), [rpe(4, 6)], { notes: "Gammes : montées de genoux, talons-fesses, 3 lignes droites" }),
      repeat(3, [step("active", time(10), [pace(97, 102)]), step("recovery", time(2), [pace(70, 78)])]),
      step("cooldown", time(10), [pace(72, 80)]),
    ]),
  }),
  runIntervals: () => ({
    sport: "run",
    title: "Piste 10 × 400 m",
    objective: "vo2max",
    content: workout("run", "Piste 10 × 400 m", [
      step("warmup", time(20), [pace(75, 82)]),
      repeat(10, [step("active", dist(400), [pace(108, 113)]), step("rest", time(1.25))]),
      step("cooldown", time(10), [pace(72, 80)]),
    ]),
  }),
  runLong: () => ({
    sport: "run",
    title: "Sortie longue 1 h 40",
    objective: "endurance",
    description: "Terrain souple si possible. Les 20 dernières minutes un cran plus vite.",
    nutrition: "Un gel à 50 min et un autre à 1 h 20, avec de l'eau.",
    content: workout("run", "Sortie longue", [
      step("active", time(80), [pace(76, 83)]),
      step("active", time(20), [pace(86, 90)]),
    ]),
  }),
  swimCss: () => ({
    sport: "swim",
    title: "CSS 8 × 100 m",
    objective: "threshold",
    content: workout("swim", "CSS 8 × 100 m", [
      step("warmup", dist(400)),
      repeat(8, [step("active", dist(100), [pace(98, 102)], { sendOffSeconds: 110 })]),
      step("cooldown", dist(200), [], { equipment: ["pull_buoy"] }),
    ]),
  }),
  swimTechnique: () => ({
    sport: "swim",
    title: "Technique et vitesse 10 × 50 m",
    objective: "technique",
    content: workout("swim", "Technique et vitesse", [
      step("warmup", dist(300)),
      repeat(6, [step("drill", dist(50), [], { notes: "Rattrapé, puis poings fermés", equipment: ["fins"] })], "Éducatifs"),
      repeat(10, [step("active", dist(50), [pace(106, 112)], { sendOffSeconds: 60 })]),
      step("cooldown", dist(200)),
    ]),
  }),
  swimEndurance: () => ({
    sport: "swim",
    title: "Endurance 3 × 600 m",
    objective: "endurance",
    content: workout("swim", "Endurance", [
      step("warmup", dist(400)),
      repeat(3, [step("active", dist(600), [pace(90, 95)]), step("rest", time(0.75))]),
      step("cooldown", dist(300)),
    ]),
  }),
  strength: () => ({
    sport: "strength",
    title: "Renforcement et gainage",
    objective: "strength",
    content: workout("strength", "Renforcement", [
      step("warmup", time(8), [rpe(2, 3)]),
      repeat(3, [
        step("active", reps(12), [rpe(6, 7)], { label: "Squats" }),
        step("active", reps(10), [rpe(6, 7)], { label: "Fentes alternées" }),
        step("active", time(1), [rpe(6, 7)], { label: "Gainage ventral" }),
        step("rest", time(1.5)),
      ]),
      step("cooldown", time(5), [rpe(1, 2)], { label: "Étirements" }),
    ]),
  }),
  brick: () => ({
    sport: "brick",
    title: "Enchaînement 1 h 15 vélo + 25 min CAP",
    objective: "race_pace",
    description: "Transition rapide : chaussures prêtes, objectif moins de 2 min.",
    content: {
      schemaVersion: 1,
      segments: [
        {
          id: id("seg"),
          sport: "bike",
          title: "Vélo",
          steps: [step("warmup", time(15), [ftp(55, 70)]), step("active", time(60), [ftp(80, 85)])],
        },
        {
          id: id("seg"),
          sport: "run",
          title: "Course",
          steps: [step("transition", time(2)), step("active", time(25), [pace(92, 97)])],
        },
      ],
    },
  }),
};
