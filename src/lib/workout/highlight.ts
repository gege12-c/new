/** Le bloc qui résume une séance : l’étape de travail qui pèse le plus en temps, et sa cible pour l’athlète. */
import { expandWorkout, resolveTarget, stepQuantities } from "./compute";
import { describeLength, describeTarget, formatClock } from "./format";
import type { Workout } from "./schema";
import type { AthleteThresholds } from "./zones";

export interface MainBlock {
  /** « 4 × 8 min » ou « 1 h 20 » */
  structure: string;
  /** Cible en valeurs absolues si les seuils le permettent, sinon telle que prescrite. */
  target: string | null;
}

export function mainBlock(workout: Workout, thresholds?: AthleteThresholds): MainBlock | null {
  const totals = new Map<string, { seconds: number; count: number; flat: ReturnType<typeof expandWorkout>[number] }>();
  for (const flat of expandWorkout(workout)) {
    if (flat.step.type !== "active") continue;
    const seconds = stepQuantities(flat.step, flat.sport, thresholds).duration.value ?? 0;
    const entry = totals.get(flat.step.id) ?? { seconds: 0, count: 0, flat };
    entry.seconds += seconds;
    entry.count += 1;
    totals.set(flat.step.id, entry);
  }
  const best = [...totals.values()].sort((a, b) => b.seconds - a.seconds || b.count - a.count)[0];
  if (!best) return null;
  const { step, sport } = best.flat;
  const structure = best.count > 1 ? `${best.count} × ${describeLength(step.length, sport)}` : describeLength(step.length, sport);
  const target = step.targets[0];
  if (!target) return { structure, target: null };
  const resolution = resolveTarget(target, sport, thresholds);
  if (resolution.ok) {
    const t = resolution.target;
    const range = (f: (n: number) => string) => (t.min === t.max ? f(t.min) : `${f(t.min)}–${f(t.max)}`);
    if (t.metric === "power") return { structure, target: `${range(String)} W` };
    if (t.metric === "heart_rate") return { structure, target: `${range(String)} bpm` };
    if (t.metric === "pace") return { structure, target: `${range(formatClock)} ${t.unit === "sec_per_km" ? "/km" : "/100 m"}` };
  }
  return { structure, target: describeTarget(target, sport) };
}
