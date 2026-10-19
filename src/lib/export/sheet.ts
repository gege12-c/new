/**
 * Fiche texte d'une séance, à recopier dans une application sans import de fichier (créateur de
 * séances Suunto, par exemple). Les cibles relatives sont suivies de leur valeur absolue quand les
 * seuils de l'athlète la permettent.
 */
import { resolveTarget } from "@/lib/workout/compute";
import { describeLength, describeTarget, formatClock } from "@/lib/workout/format";
import { EQUIPMENT_LABELS, SPORT_LABELS, STEP_TYPE_LABELS, type SegmentSport, type Target, type Workout, type WorkoutNode } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";

function targetText(target: Target, sport: SegmentSport, thresholds?: AthleteThresholds): string {
  const prescribed = describeTarget(target, sport);
  const resolution = resolveTarget(target, sport, thresholds);
  if (!resolution.ok) return prescribed;
  const t = resolution.target;
  const range = (min: number, max: number, f: (n: number) => string) => (min === max ? f(min) : `${f(min)}–${f(max)}`);
  let absolute: string | null = null;
  if (t.metric === "power") absolute = `${range(t.min, t.max, String)} W`;
  if (t.metric === "heart_rate") absolute = `${range(t.min, t.max, String)} bpm`;
  if (t.metric === "pace") absolute = `${range(t.min, t.max, formatClock)} ${t.unit === "sec_per_km" ? "/km" : "/100 m"}`;
  return absolute && absolute !== prescribed ? `${absolute} (${prescribed})` : prescribed;
}

function lines(nodes: WorkoutNode[], sport: SegmentSport, thresholds: AthleteThresholds | undefined, depth: number): string[] {
  const indent = "   ".repeat(depth);
  const out: string[] = [];
  nodes.forEach((node, index) => {
    const marker = depth === 0 ? `${index + 1}.` : "-";
    if (node.kind === "repeat") {
      out.push(`${indent}${marker} ${node.count} fois${node.label ? ` (${node.label})` : ""} :`);
      out.push(...lines(node.steps, sport, thresholds, depth + 1));
      return;
    }
    const parts = [
      describeLength(node.length, sport),
      node.label || STEP_TYPE_LABELS[node.type],
      ...node.targets.map((t) => targetText(t, sport, thresholds)),
      node.sendOffSeconds ? `départ toutes les ${formatClock(node.sendOffSeconds)}` : null,
      node.equipment?.length ? `matériel : ${node.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ")}` : null,
    ].filter(Boolean);
    out.push(`${indent}${marker} ${parts.join(" — ")}`);
    if (node.notes) out.push(`${indent}   ${node.notes.replace(/\s+/g, " ")}`);
  });
  return out;
}

export function workoutSheet(workout: Workout, options: { title: string; thresholds?: AthleteThresholds; description?: string | null }): string {
  const out = [options.title];
  workout.segments.forEach((segment) => {
    out.push("");
    out.push(`${SPORT_LABELS[segment.sport]}${segment.title ? ` — ${segment.title}` : ""}`);
    if (segment.goal) out.push(segment.goal);
    out.push(...lines(segment.steps, segment.sport, options.thresholds, 0));
  });
  if (options.description) {
    out.push("", "Consignes :", options.description.trim());
  }
  return out.join("\n");
}
