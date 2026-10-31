/**
 * Séances prévues dans le calendrier intervals.icu (par le coach de l'athlète, ou par lui-même),
 * converties au format de séance de TriCoach.
 *
 * Lecture : `GET /api/v1/athlete/0/events?category=WORKOUT&resolve=true` (spécification OpenAPI
 * d'intervals.icu, listEvents). Le déroulé vient de `workout_doc`, la séance telle qu'intervals.icu l'a
 * lue dans la description : étapes (durée ou distance), répétitions (`reps` et `steps`), cibles avec
 * leur unité (« %ftp », « w », « power_zone », « %lthr », « %hr », « hr_zone », « %pace »,
 * « pace_zone ») et, avec `resolve=true`, les mêmes en valeurs absolues (`_power` en W, `_hr` en bpm,
 * `_pace` en m/s). Sans `workout_doc`, la description est lue comme dans l'éditeur en texte.
 *
 * Rien n'est deviné : une cible dans une unité inconnue n'est reprise qu'en valeur absolue fournie
 * par intervals.icu, sinon elle est notée (`notes`), et la description du coach reste entière.
 */
import { z } from "zod";
import { stravaSport } from "@/lib/strava/normalize";
import { inferStepType, parseWorkoutText } from "@/lib/workout/text";
import {
  LIMITS,
  SPORT_TARGETS,
  TargetSchema,
  WorkoutSchema,
  type SegmentSport,
  type Step,
  type StepType,
  type Target,
  type Workout,
  type WorkoutNode,
} from "@/lib/workout/schema";

/** Période relue à chaque réception : les 8 dernières semaines (prévu contre réalisé) et les 8 prochaines. */
export const PLANNED_PAST_DAYS = 56;
export const PLANNED_FUTURE_DAYS = 56;
/** Séances que TriCoach dépose lui-même chez intervals.icu : jamais reprises. */
export const OWN_EXTERNAL_PREFIX = "tricoach-";

const num = z.number().nullish().catch(null);
const text = z.string().nullish().catch(null);
const flag = z.boolean().nullish().catch(null);

export const IntervalsPlannedSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    start_date_local: text,
    category: text,
    type: text,
    name: text,
    description: text,
    moving_time: num,
    distance: num,
    external_id: text,
    updated: text,
    target: text,
    hide_from_athlete: flag,
    workout_doc: z.unknown().optional(),
  })
  .loose();

const ValueSchema = z.object({ value: num, start: num, end: num, units: text }).loose();
type DocValue = z.infer<typeof ValueSchema>;
const value = ValueSchema.nullish().catch(null);

interface DocStep {
  text?: string | null;
  duration?: number | null;
  distance?: number | null;
  reps?: number | null;
  steps?: DocStep[] | null;
  warmup?: boolean | null;
  cooldown?: boolean | null;
  intensity?: string | null;
  ramp?: boolean | null;
  freeride?: boolean | null;
  maxeffort?: boolean | null;
  until_lap_press?: boolean | null;
  power?: DocValue | null;
  hr?: DocValue | null;
  pace?: DocValue | null;
  cadence?: DocValue | null;
  _power?: DocValue | null;
  _hr?: DocValue | null;
  _pace?: DocValue | null;
}

const DocStepSchema: z.ZodType<DocStep> = z.lazy(() =>
  z
    .object({
      text,
      duration: num,
      distance: num,
      reps: num,
      steps: z.array(DocStepSchema).nullish().catch(null),
      warmup: flag,
      cooldown: flag,
      intensity: text,
      ramp: flag,
      freeride: flag,
      maxeffort: flag,
      until_lap_press: flag,
      power: value,
      hr: value,
      pace: value,
      cadence: value,
      _power: value,
      _hr: value,
      _pace: value,
    })
    .loose(),
);
const WorkoutDocSchema = z.object({ steps: z.array(DocStepSchema).nullish().catch(null), target: text }).loose();

export interface PlannedFields {
  external_id: string;
  external_updated_at: string | null;
  scheduled_date: string;
  start_time: string | null;
  sport: SegmentSport;
  title: string;
  description: string | null;
  content: Workout;
  /** Durée et distance prévues par intervals.icu (avec ses seuils) : à défaut d'un calcul de TriCoach. */
  moving_s: number | null;
  distance_m: number | null;
  import_notes: string[];
}

export type PlannedOutcome = { kind: "workout"; fields: PlannedFields } | { kind: "skip"; reason: "ours" | "hidden" | "not_workout" | "unreadable" };

const SPORT_NAMES: Record<SegmentSport, string> = { swim: "Natation", bike: "Vélo", run: "Course à pied", strength: "Renforcement", other: "Séance" };
const METRIC_NAMES: Record<string, string> = { power: "puissance", heart_rate: "fréquence cardiaque", pace: "allure", cadence: "cadence" };
const LOCAL = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/;

const round = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

function rangeOf(v: DocValue | null | undefined): { min: number; max: number } | null {
  if (!v) return null;
  const a = v.start ?? v.value;
  const b = v.end ?? v.value;
  if (a === null || a === undefined || b === null || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

/** Une cible valable pour la discipline (bornes et unités de TriCoach), sinon null. */
function accepted(candidate: Target | null, sport: SegmentSport): Target | null {
  if (!candidate) return null;
  if (!SPORT_TARGETS[sport].includes(`${candidate.metric}.${candidate.unit}`)) return null;
  const parsed = TargetSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const zone = (metric: Target["metric"], r: { min: number; max: number }): Target => ({ metric, unit: "zone", min: Math.round(r.min), max: Math.round(r.max) });

/**
 * Une mesure d'une étape (puissance, FC, allure ou cadence) : dans son unité si TriCoach la connaît,
 * sinon en valeur absolue (calculée par intervals.icu avec les seuils de l'athlète), sinon null.
 */
function convertTarget(kind: "power" | "hr" | "pace" | "cadence", step: DocStep, sport: SegmentSport): { target: Target | null; present: boolean } {
  const v = step[kind];
  const resolved = kind === "cadence" ? null : step[`_${kind}` as "_power" | "_hr" | "_pace"];
  const r = rangeOf(v);
  const present = Boolean(r || rangeOf(resolved));
  const units = (v?.units ?? "").toLowerCase();
  let direct: Target | null = null;
  if (r) {
    if (kind === "power") {
      if (units === "%ftp") direct = { metric: "power", unit: "percent_ftp", min: round(r.min, 1), max: round(r.max, 1) };
      else if (units === "w") direct = { metric: "power", unit: "watts", min: Math.round(r.min), max: Math.round(r.max) };
      else if (units === "power_zone") direct = zone("power", r);
    } else if (kind === "hr") {
      if (units === "%lthr") direct = { metric: "heart_rate", unit: "percent_lthr", min: round(r.min, 1), max: round(r.max, 1) };
      else if (units === "%hr") direct = { metric: "heart_rate", unit: "percent_max_hr", min: round(r.min, 1), max: round(r.max, 1) };
      else if (units === "hr_zone") direct = zone("heart_rate", r);
      else if (units === "bpm") direct = { metric: "heart_rate", unit: "bpm", min: Math.round(r.min), max: Math.round(r.max) };
    } else if (kind === "pace") {
      // % de la vitesse au seuil, comme dans TriCoach (110 % : plus vite que le seuil).
      if (units === "%pace") direct = { metric: "pace", unit: "percent_threshold", min: round(r.min, 1), max: round(r.max, 1) };
      else if (units === "pace_zone") direct = zone("pace", r);
    } else if (units === "rpm" && sport === "bike") {
      direct = { metric: "cadence", unit: "rpm", min: Math.round(r.min), max: Math.round(r.max) };
    } else if (units === "spm" && sport === "run") {
      direct = { metric: "cadence", unit: "spm", min: Math.round(r.min), max: Math.round(r.max) };
    }
  }
  const kept = accepted(direct, sport);
  if (kept) return { target: kept, present };
  // Valeurs absolues d'intervals.icu : W, bpm, m/s.
  const abs = rangeOf(resolved);
  if (abs && kind === "power") return { target: accepted({ metric: "power", unit: "watts", min: Math.round(abs.min), max: Math.round(abs.max) }, sport), present };
  if (abs && kind === "hr") return { target: accepted({ metric: "heart_rate", unit: "bpm", min: Math.round(abs.min), max: Math.round(abs.max) }, sport), present };
  if (abs && kind === "pace" && abs.min > 0) {
    // Vitesse → allure : la vitesse la plus haute donne l'allure la plus rapide (borne basse).
    const per = sport === "swim" ? 100 : 1000;
    const unit = sport === "swim" ? "sec_per_100m" : "sec_per_km";
    return { target: accepted({ metric: "pace", unit, min: Math.round(per / abs.max), max: Math.round(per / abs.min) }, sport), present };
  }
  return { target: null, present };
}

/** Ordre de priorité des cibles d'une étape (deux au plus dans TriCoach). */
function priority(sport: SegmentSport, eventTarget: string | null): ("power" | "hr" | "pace")[] {
  const preferred = eventTarget === "POWER" ? "power" : eventTarget === "HR" ? "hr" : eventTarget === "PACE" ? "pace" : null;
  const base: ("power" | "hr" | "pace")[] = sport === "bike" ? ["power", "hr", "pace"] : sport === "run" || sport === "swim" ? ["pace", "hr", "power"] : ["hr", "power", "pace"];
  return preferred ? [preferred, ...base.filter((k) => k !== preferred)] : base;
}

function stepType(step: DocStep): StepType {
  if (step.warmup) return "warmup";
  if (step.cooldown) return "cooldown";
  const intensity = (step.intensity ?? "").toLowerCase();
  if (intensity === "recovery") return "recovery";
  if (intensity === "rest") return "rest";
  if (intensity === "warmup") return "warmup";
  if (intensity === "cooldown") return "cooldown";
  return inferStepType(step.text ?? undefined);
}

interface Context {
  sport: SegmentSport;
  eventTarget: string | null;
  notes: Set<string>;
  counter: number;
}

function convertStep(step: DocStep, ctx: Context): Step {
  const length: Step["length"] =
    step.duration && step.duration > 0
      ? { unit: "time", seconds: Math.min(LIMITS.maxStepSeconds, Math.max(1, Math.round(step.duration))) }
      : step.distance && step.distance > 0
        ? { unit: "distance", meters: Math.min(LIMITS.maxStepMeters, round(step.distance, 1)) }
        : { unit: "open" };
  const targets: Target[] = [];
  const extra: string[] = [];
  for (const kind of [...priority(ctx.sport, ctx.eventTarget), "cadence" as const]) {
    const { target, present } = convertTarget(kind, step, ctx.sport);
    if (!present) continue;
    if (!target) {
      ctx.notes.add(`Une cible de ${METRIC_NAMES[kind === "hr" ? "heart_rate" : kind]} n'a pas pu être reprise (unité inconnue de TriCoach) : voir la description.`);
      continue;
    }
    if (targets.length >= LIMITS.maxTargetsPerStep || targets.some((t) => t.metric === target.metric)) {
      extra.push(METRIC_NAMES[target.metric] ?? target.metric);
      continue;
    }
    targets.push(target);
  }
  const label = step.text?.trim().replace(/\s+/g, " ");
  const notes = [
    label && label.length > 80 ? label : null,
    step.ramp ? "Progressif : du bas au haut de la plage." : null,
    step.freeride ? "Libre : sans cible imposée." : null,
    step.maxeffort ? "Effort maximal." : null,
    extra.length ? `Cible aussi donnée par intervals.icu, non reprise ici (deux cibles au plus par étape) : ${extra.join(", ")}.` : null,
  ].filter((n): n is string => Boolean(n));
  ctx.counter += 1;
  return {
    kind: "step",
    id: `i${ctx.counter}`,
    type: stepType(step),
    length,
    targets,
    ...(label ? { label: label.slice(0, 80) } : {}),
    ...(notes.length ? { notes: notes.join(" ").slice(0, LIMITS.maxText) } : {}),
  };
}

function convertNodes(steps: DocStep[], ctx: Context, depth: number): WorkoutNode[] {
  const nodes: WorkoutNode[] = [];
  for (const step of steps) {
    const children = step.steps ?? [];
    if (children.length) {
      const reps = Math.round(step.reps ?? 1);
      const inner = depth >= LIMITS.maxRepeatDepth ? [] : convertNodes(children, ctx, depth + 1);
      if (!inner.length) {
        ctx.notes.add("Une répétition trop imbriquée n'a pas pu être reprise : voir la description.");
        continue;
      }
      if (reps <= 1) {
        nodes.push(...inner);
        continue;
      }
      ctx.counter += 1;
      const label = step.text?.trim().replace(/\s+/g, " ").slice(0, 80);
      nodes.push({ kind: "repeat", id: `r${ctx.counter}`, count: Math.min(LIMITS.maxRepeatCount, reps), steps: inner, ...(label ? { label } : {}) });
      continue;
    }
    nodes.push(convertStep(step, ctx));
  }
  return nodes;
}

/** Une étape unique, quand intervals.icu ne donne aucun déroulé : la durée (ou distance) prévue. */
function singleStep(sport: SegmentSport, moving: number | null, distance: number | null): Workout {
  const length: Step["length"] =
    moving && moving > 0
      ? { unit: "time", seconds: Math.min(LIMITS.maxStepSeconds, Math.round(moving)) }
      : distance && distance > 0
        ? { unit: "distance", meters: Math.min(LIMITS.maxStepMeters, round(distance, 1)) }
        : { unit: "open" };
  return { schemaVersion: 1, segments: [{ id: "s1", sport, steps: [{ kind: "step", id: "i1", type: "active", length, targets: [] }] }] };
}

/** Déroulé de la séance : `workout_doc`, sinon la description lue comme du texte, sinon une étape. */
export function plannedWorkout(
  doc: unknown,
  description: string | null,
  sport: SegmentSport,
  eventTarget: string | null,
  moving: number | null,
  distance: number | null,
): { workout: Workout; notes: string[] } {
  const parsedDoc = WorkoutDocSchema.safeParse(doc);
  const steps = parsedDoc.success ? (parsedDoc.data.steps ?? []) : [];
  if (steps.length) {
    const ctx: Context = { sport, eventTarget: eventTarget ?? parsedDoc.data?.target ?? null, notes: new Set(), counter: 0 };
    const nodes = convertNodes(steps, ctx, 0);
    const workout = nodes.length ? WorkoutSchema.safeParse({ schemaVersion: 1, segments: [{ id: "s1", sport, steps: nodes.slice(0, LIMITS.maxNodesPerList) }] }) : null;
    if (workout?.success) {
      if (nodes.length > LIMITS.maxNodesPerList) ctx.notes.add("Séance trop longue : seules les premières étapes sont reprises.");
      return { workout: workout.data, notes: [...ctx.notes] };
    }
  }
  if (description && /^\s*[-–•*]\s*\S/m.test(description)) {
    const fromText = parseWorkoutText(description, sport);
    if (fromText.workout) {
      return {
        workout: fromText.workout,
        notes: fromText.issues.length ? ["Une partie de la description n'a pas pu être lue comme des étapes : elle reste dans la description."] : [],
      };
    }
  }
  return {
    workout: singleStep(sport, moving, distance),
    notes: [steps.length ? "Le déroulé d'intervals.icu n'a pas pu être repris : la séance est résumée en une étape, détail dans la description." : "Pas de déroulé détaillé dans intervals.icu : la séance tient en une étape, détail dans la description."],
  };
}

/** Une séance du calendrier intervals.icu → champs d'une séance prévue de TriCoach (ou la raison de l'écarter). */
export function normalizePlannedEvent(raw: unknown): PlannedOutcome {
  const parsed = IntervalsPlannedSchema.safeParse(raw);
  if (!parsed.success) return { kind: "skip", reason: "unreadable" };
  const e = parsed.data;
  if ((e.category ?? "WORKOUT").toUpperCase() !== "WORKOUT") return { kind: "skip", reason: "not_workout" };
  if (e.external_id?.startsWith(OWN_EXTERNAL_PREFIX)) return { kind: "skip", reason: "ours" };
  if (e.hide_from_athlete) return { kind: "skip", reason: "hidden" };
  const local = e.start_date_local?.match(LOCAL);
  if (!local || e.id.length > 100) return { kind: "skip", reason: "unreadable" };
  const sport: SegmentSport = e.type === "OpenWaterSwim" ? "swim" : stravaSport(e.type);
  const moving = e.moving_time && e.moving_time > 0 ? Math.round(e.moving_time) : null;
  const distance = e.distance && e.distance > 0 ? round(e.distance, 1) : null;
  const description = e.description?.trim() || null;
  const { workout, notes } = plannedWorkout(e.workout_doc, description, sport, e.target?.toUpperCase() ?? null, moving, distance);
  if (description && description.length > 4000) notes.push("Description trop longue : seul le début est repris ici.");
  const time = local[2] && local[2] !== "00:00:00" ? local[2] : null;
  const updated = e.updated && !Number.isNaN(Date.parse(e.updated)) ? new Date(e.updated).toISOString() : null;
  return {
    kind: "workout",
    fields: {
      external_id: e.id,
      external_updated_at: updated,
      scheduled_date: local[1],
      start_time: time,
      sport,
      title: (e.name?.trim() || SPORT_NAMES[sport]).slice(0, 120),
      description: description ? description.slice(0, 4000) : null,
      content: workout,
      moving_s: moving,
      distance_m: distance,
      import_notes: notes.map((n) => n.slice(0, 300)).slice(0, 20),
    },
  };
}
