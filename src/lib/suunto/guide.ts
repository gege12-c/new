/**
 * Séance TriCoach → guide SuuntoPlus, au format « sequence » de l'API Guides de Suunto.
 *
 * Ce que dit la description officielle des guides (apizone.suunto.com, SuuntoPlus Guide description) :
 * - un guide est une suite d'étapes : « fields » (un écran de champs) ou « repeat » (un seul niveau de
 *   répétition, sans répétition imbriquée), 1 000 étapes au plus ;
 * - une étape passe à la suivante par une condition : durée de l'étape (s), distance de l'étape (m)
 *   ou bouton tour ;
 * - champs, par ordre de priorité d'affichage (4 ou 5 au plus) : texte (54 caractères ; au-delà de 40
 *   il masque les autres champs), décomptes de durée et de distance de l'étape, valeurs mesurées,
 *   cibles : fréquence cardiaque (bpm), puissance (W), allure et vitesse (m/s), cadence (Hz) ;
 * - une notification (titre de 13 caractères, texte de 54) au début de chaque étape ;
 * - nom (60), description obligatoire (256), description courte (23), propriétaire (le nom de
 *   l'application chez Suunto), adresse (256), date locale, identifiant externe (64, unique par compte).
 *
 * Les cibles relatives sont converties en valeurs absolues avec les seuils de l'athlète à la date de
 * la séance. Ce que la montre ne suit pas (effort ressenti, cadence de course, consignes, matériel,
 * départs) est rappelé dans la notification de l'étape et signalé : rien n'est perdu en silence, et
 * une cible impossible à convertir n'est jamais devinée. Pur : utilisable partout.
 */
import { z } from "zod";
import type { CompatibilityIssue } from "@/lib/export/types";
import { addDays } from "@/lib/planning/dates";
import { watchText } from "@/lib/watch/text";
import { computeTotals, resolveTarget, type MissingThreshold, type ResolvedTarget } from "@/lib/workout/compute";
import { describeLength, describeTarget, formatClock, formatDurationShort, summarizeNodes } from "@/lib/workout/format";
import { EQUIPMENT_LABELS, SPORT_LABELS, STEP_TYPE_LABELS, type SegmentSport, type Step, type StepType, type Workout, type WorkoutNode } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";

/** Version de la conversion : la changer renvoie tous les guides (nouvelle empreinte). */
export const GUIDE_FORMAT_VERSION = 1;

/** Fenêtre d'envoi : la séance du jour et les 6 suivants (date locale de l'athlète). */
export const GUIDE_WINDOW_DAYS = 7;

export const GUIDE_LIMITS = {
  name: 60,
  description: 256,
  shortDescription: 23,
  owner: 64,
  url: 256,
  externalId: 64,
  title: 13,
  text: 54,
  textBesideFields: 40,
  fields: 5,
  steps: 1000,
  repeatTimes: 100,
} as const;

// ---------------------------------------------------------------------------
// Format du guide, contrôlé avant chaque envoi
// ---------------------------------------------------------------------------

const positive = z.number().positive().finite();
const ConditionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("manualLap") }),
  z.strictObject({ type: z.literal("stepDuration"), value: positive }),
  z.strictObject({ type: z.literal("stepDistance"), value: positive }),
]);
const fieldTitle = z.string().min(1).max(GUIDE_LIMITS.title).optional();
const TargetFieldSchema = z
  .strictObject({
    type: z.enum(["targetHeartRate", "targetPower", "targetPace", "targetSpeed", "targetCadence"]),
    title: fieldTitle,
    value: z.number().nonnegative().finite(),
    min: z.number().nonnegative().finite(),
    max: positive,
  })
  .refine((field) => field.min <= field.value && field.value <= field.max, { message: "Cible incohérente (borne basse au-dessus de la borne haute)." });
const FieldSchema = z.union([
  z.strictObject({ type: z.literal("text"), value: z.string().min(1).max(GUIDE_LIMITS.text) }),
  z.strictObject({ type: z.literal("stepDurationCountdown"), title: fieldTitle, value: positive }),
  z.strictObject({ type: z.literal("stepDistanceCountdown"), title: fieldTitle, value: positive }),
  z.strictObject({ type: z.enum(["heartRate", "power", "pace", "speed", "cadence"]), title: fieldTitle }),
  z.strictObject({ type: z.literal("duration"), title: fieldTitle, window: z.enum(["workout", "step", "manualLap"]) }),
  TargetFieldSchema,
]);
const FieldsStepSchema = z
  .strictObject({
    type: z.literal("fields"),
    title: z.string().min(1).max(GUIDE_LIMITS.title),
    createManualLap: z.boolean().optional(),
    transitions: z.array(z.strictObject({ condition: ConditionSchema })).min(1).max(1).optional(),
    fields: z.array(FieldSchema).min(1).max(GUIDE_LIMITS.fields),
    notification: z.strictObject({ title: z.string().min(1).max(GUIDE_LIMITS.title), text: z.string().min(1).max(GUIDE_LIMITS.text) }).optional(),
  })
  .refine((step) => step.fields.length === 1 || step.fields.every((f) => f.type !== "text" || f.value.length <= GUIDE_LIMITS.textBesideFields), {
    message: "Texte de plus de 40 caractères à côté d'autres champs : ils seraient masqués.",
  });
const RepeatStepSchema = z.strictObject({
  type: z.literal("repeat"),
  times: z.int().min(1).max(GUIDE_LIMITS.repeatTimes),
  steps: z.array(FieldsStepSchema).min(1),
});

export const GuideSchema = z
  .strictObject({
    type: z.literal("sequence"),
    name: z.string().min(1).max(GUIDE_LIMITS.name),
    description: z.string().min(1).max(GUIDE_LIMITS.description),
    shortDescription: z.string().min(1).max(GUIDE_LIMITS.shortDescription),
    owner: z.string().min(1).max(GUIDE_LIMITS.owner),
    url: z.string().min(1).max(GUIDE_LIMITS.url),
    usage: z.literal("workout"),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    externalId: z.string().min(1).max(GUIDE_LIMITS.externalId),
    activities: z.array(z.int().nonnegative()).min(1).max(100).optional(),
    steps: z.array(z.union([FieldsStepSchema, RepeatStepSchema])).min(1),
  })
  .refine((guide) => countSteps(guide.steps) <= GUIDE_LIMITS.steps, { message: "Plus de 1 000 étapes." });

export const ManifestSchema = z.strictObject({
  name: z.string().min(1).max(GUIDE_LIMITS.name),
  type: z.literal("sequence"),
  owner: z.string().min(1).max(GUIDE_LIMITS.owner),
  description: z.string().min(1).max(GUIDE_LIMITS.description),
});

export type SuuntoGuide = z.infer<typeof GuideSchema>;
export type SuuntoManifest = z.infer<typeof ManifestSchema>;
type FieldsStep = z.infer<typeof FieldsStepSchema>;
type GuideStep = FieldsStep | z.infer<typeof RepeatStepSchema>;
type Field = z.infer<typeof FieldSchema>;
type TargetField = z.infer<typeof TargetFieldSchema>;

function countSteps(steps: GuideStep[]): number {
  return steps.reduce((n, step) => n + 1 + (step.type === "repeat" ? step.steps.length : 0), 0);
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export interface GuideContext {
  sessionId: string;
  title: string;
  description: string | null;
  nutrition: string | null;
  /** Date locale de la séance (AAAA-MM-JJ). */
  date: string;
  /** Adresse de la séance dans TriCoach, ouverte depuis l'application Suunto. */
  url: string;
  /** Nom de l'application chez Suunto (exigé tel quel par l'API). */
  owner: string;
  thresholds?: AthleteThresholds;
  /** Modes sportifs Suunto proposant le guide, par discipline (facultatif : sinon, tous). */
  activities?: Partial<Record<SegmentSport, number[]>>;
}

export interface GuideBuild {
  segmentIndex: number;
  sport: SegmentSport;
  externalId: string;
  issues: CompatibilityIssue[];
  /** null : le guide ne peut pas être produit (écart bloquant, expliqué dans `issues`). */
  guide: SuuntoGuide | null;
  manifest: SuuntoManifest | null;
}

/** Identifiant externe d'un guide : unique par compte Suunto, stable d'une version à l'autre. */
export function externalIdFor(sessionId: string, segmentIndex: number): string {
  return `tricoach-${sessionId}-${segmentIndex}`;
}

/** La séance est-elle dans la fenêtre d'envoi (aujourd'hui et les 6 jours suivants) ? */
export function inGuideWindow(date: string, today: string): boolean {
  return date >= today && date <= addDays(today, GUIDE_WINDOW_DAYS - 1);
}

/** Titres d'étape de 13 caractères au plus. */
const TITLES: Record<StepType, string> = {
  warmup: "Échauffement",
  active: "Travail",
  recovery: "Récupération",
  rest: "Repos",
  cooldown: "Retour calme",
  drill: "Éducatifs",
  transition: "Transition",
};

const MISSING: Record<Exclude<MissingThreshold, "unsupported">, string> = {
  bike_ftp: "sans FTP vélo enregistrée",
  bike_lthr: "sans FC seuil vélo enregistrée",
  run_lthr: "sans FC seuil course enregistrée",
  max_hr: "sans FC maximale enregistrée",
  run_threshold_pace: "sans allure seuil course enregistrée",
  swim_css: "sans CSS natation enregistrée",
};

/** Texte lisible par la montre, raccourci à `max` caractères. */
function clip(text: string, max: number): { text: string; clipped: boolean } {
  const flat = watchText(text);
  if (flat.length <= max) return { text: flat, clipped: false };
  return { text: `${flat.slice(0, max - 3).trimEnd()}...`, clipped: true };
}

const round = (value: number, digits = 0) => Number(value.toFixed(digits));
const mid = (min: number, max: number, digits = 0) => round((min + max) / 2, digits);
const span = (min: number, max: number, format: (n: number) => string) => (min === max ? format(min) : `${format(min)}-${format(max)}`);
const integer = (n: number) => String(Math.round(n));
const decimal = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n);

/** Cible convertie en champ de la montre, avec sa valeur mesurée et son texte. */
function targetField(target: ResolvedTarget): { field: TargetField; measured: Field; text: string } | null {
  switch (target.metric) {
    case "power":
      return {
        field: { type: "targetPower", value: mid(target.min, target.max), min: round(target.min), max: round(target.max) },
        measured: { type: "power", title: "PUIS" },
        text: `${span(target.min, target.max, integer)} W`,
      };
    case "heart_rate":
      return {
        field: { type: "targetHeartRate", value: mid(target.min, target.max), min: round(target.min), max: round(target.max) },
        measured: { type: "heartRate", title: "FC" },
        text: `${span(target.min, target.max, integer)} bpm`,
      };
    case "pace": {
      // Allure : `min` est la borne rapide. Chez Suunto, en m/s : la borne basse est la plus lente.
      const meters = target.unit === "sec_per_km" ? 1000 : 100;
      const slow = meters / target.max;
      const fast = meters / target.min;
      return {
        field: { type: "targetPace", value: mid(slow, fast, 3), min: round(slow, 3), max: round(fast, 3) },
        measured: { type: "pace", title: "ALLURE" },
        text: `${span(target.min, target.max, formatClock)} ${target.unit === "sec_per_km" ? "/km" : "/100 m"}`,
      };
    }
    case "speed":
      return {
        field: { type: "targetSpeed", value: mid(target.min / 3.6, target.max / 3.6, 3), min: round(target.min / 3.6, 3), max: round(target.max / 3.6, 3) },
        measured: { type: "speed", title: "VIT" },
        text: `${span(target.min, target.max, decimal)} km/h`,
      };
    case "cadence":
      // Cadence de pédalage (tours par minute) en hertz ; la cadence de course n'est pas transmise.
      if (target.unit !== "rpm") return null;
      return {
        field: { type: "targetCadence", value: mid(target.min / 60, target.max / 60, 3), min: round(target.min / 60, 3), max: round(target.max / 60, 3) },
        measured: { type: "cadence", title: "CAD" },
        text: `${span(target.min, target.max, integer)} rpm`,
      };
    default:
      return null;
  }
}

interface Converter {
  sport: SegmentSport;
  thresholds?: AthleteThresholds;
  issues: CompatibilityIssue[];
  once: Set<string>;
  /** Rang de l'étape TriCoach (parcours de la séance, chaque étape comptée une fois). */
  index: number;
}

function noteOnce(c: Converter, key: string, issue: CompatibilityIssue) {
  if (c.once.has(key)) return;
  c.once.add(key);
  c.issues.push(issue);
}

/** Valeur en direct quand l'étape n'a pas de cible : l'allure ou la vitesse selon le sport. */
const LIVE: Record<SegmentSport, Field> = {
  run: { type: "pace", title: "ALLURE" },
  swim: { type: "pace", title: "ALLURE" },
  bike: { type: "speed", title: "VIT" },
  strength: { type: "heartRate", title: "FC" },
  other: { type: "heartRate", title: "FC" },
};

function convertStep(c: Converter, step: Step): FieldsStep {
  c.index += 1;
  const label = step.label?.trim() || STEP_TYPE_LABELS[step.type];
  const at = `Étape ${c.index}, ${label}`;
  const title = clip(step.label?.trim() || TITLES[step.type], GUIDE_LIMITS.title);
  // Consignes que les champs de la montre ne montrent pas : sur l'écran de l'étape et dans sa notification.
  const reminders: string[] = [];
  if (title.clipped) reminders.push(label);

  const targets: { field: TargetField; measured: Field; text: string }[] = [];
  for (const target of step.targets) {
    const wording = describeTarget(target, c.sport);
    if (target.metric === "rpe") {
      reminders.push(`RPE ${span(target.min, target.max, integer)}/10`);
      noteOnce(c, "rpe", { severity: "info", message: "Effort ressenti (RPE) : la montre ne le mesure pas, il est rappelé à l'écran de l'étape." });
      continue;
    }
    const resolved = resolveTarget(target, c.sport, c.thresholds);
    if (!resolved.ok) {
      reminders.push(wording);
      const why = resolved.missing === "unsupported" ? "cible non prise en charge" : `${MISSING[resolved.missing]}, cible non convertible`;
      c.issues.push({ severity: "loss", where: at, message: `${wording} : ${why} (rappelée à l'écran de l'étape).` });
      continue;
    }
    const converted = targetField(resolved.target);
    if (!converted) {
      reminders.push(wording);
      c.issues.push({
        severity: "loss",
        where: at,
        message: `${wording} : cadence de course non transmise (pas ou foulées selon les montres), rappelée à l'écran de l'étape.`,
      });
      continue;
    }
    targets.push(converted);
  }

  const length = step.length;
  let lengthField: Field;
  let condition: z.infer<typeof ConditionSchema>;
  switch (length.unit) {
    case "time":
      lengthField = { type: "stepDurationCountdown", title: "RESTE", value: length.seconds };
      condition = { type: "stepDuration", value: length.seconds };
      break;
    case "distance":
      lengthField = { type: "stepDistanceCountdown", title: "RESTE", value: round(length.meters, 1) };
      condition = { type: "stepDistance", value: round(length.meters, 1) };
      break;
    case "reps":
      lengthField = { type: "duration", title: "TEMPS", window: "step" };
      condition = { type: "manualLap" };
      reminders.unshift(`${length.reps} répétition${length.reps > 1 ? "s" : ""}`);
      noteOnce(c, "reps", { severity: "info", message: "Étapes en répétitions : appuyez sur le bouton tour à la fin de chaque série." });
      break;
    case "open":
      lengthField = { type: "duration", title: "TEMPS", window: "step" };
      condition = { type: "manualLap" };
      noteOnce(c, "open", { severity: "info", message: "Durée libre : appuyez sur le bouton tour pour passer à l'étape suivante." });
      break;
  }

  if (step.sendOffSeconds) {
    reminders.push(`Départ toutes les ${formatClock(step.sendOffSeconds)}`);
    c.issues.push({
      severity: "loss",
      where: at,
      message: `Départ toutes les ${formatClock(step.sendOffSeconds)} : la montre ne le décompte pas, il est rappelé à l'écran de l'étape.`,
    });
  }
  if (step.equipment?.length) reminders.push(`Matériel : ${step.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ")}`);
  if (step.notes?.trim()) reminders.push(step.notes);

  // Par ordre de priorité d'affichage : la cible et sa valeur en direct, le décompte, la deuxième
  // cible ou la fréquence cardiaque, puis la première consigne (40 caractères, sans masquer le reste).
  const [primary, secondary] = targets;
  const fields: Field[] = primary ? [{ ...primary.field, title: "CIBLE" }, primary.measured] : [LIVE[c.sport]];
  fields.push(lengthField);
  if (secondary) fields.push({ ...secondary.field, title: "CIBLE 2" });
  else if (!fields.some((f) => f.type === "heartRate")) fields.push({ type: "heartRate", title: "FC" });
  if (reminders[0]) fields.push({ type: "text", value: clip(reminders[0], GUIDE_LIMITS.textBesideFields).text });

  // Notification au début de l'étape : « 8 min · 238-250 W · consignes ».
  const full = [describeLength(length, c.sport), ...targets.map((t) => t.text), ...reminders].join(" · ");
  const message = clip(full, GUIDE_LIMITS.text);
  if (message.clipped && reminders.length) {
    c.issues.push({
      severity: "loss",
      where: at,
      message: `Consignes raccourcies sur la montre (${GUIDE_LIMITS.text} caractères à l'écran) : le texte complet reste dans TriCoach.`,
    });
  }

  return {
    type: "fields",
    title: title.text,
    transitions: [{ condition }],
    fields: fields.slice(0, GUIDE_LIMITS.fields),
    notification: { title: title.text, text: message.text || title.text },
  };
}

/** Étapes d'une liste, répétitions intérieures déroulées (la montre n'a qu'un niveau de répétition). */
function flatten(c: Converter, nodes: WorkoutNode[]): FieldsStep[] {
  return nodes.flatMap((node) => {
    if (node.kind === "step") return [convertStep(c, node)];
    noteOnce(c, "nested", {
      severity: "info",
      message: "Répétition dans une répétition : déroulée dans la répétition qui la contient (la montre n'a qu'un niveau de répétition).",
    });
    const body = flatten(c, node.steps);
    return Array.from({ length: node.count }, () => body).flat();
  });
}

function convertNodes(c: Converter, nodes: WorkoutNode[]): GuideStep[] {
  return nodes.flatMap((node): GuideStep[] => {
    if (node.kind === "step") return [convertStep(c, node)];
    const body = flatten(c, node.steps);
    return node.count === 1 ? body : [{ type: "repeat", times: node.count, steps: body }];
  });
}

const autoAdvances = (step: FieldsStep) => step.transitions?.[0]?.condition.type !== "manualLap";

/**
 * Un tour au début de chaque étape qui suit une étape terminée seule (durée, distance) : l'appui sur
 * le bouton tour en crée déjà un. L'activité enregistrée a ainsi un tour par étape.
 */
function markLaps(steps: GuideStep[]): void {
  let previous: FieldsStep | null = null;
  for (const step of steps) {
    if (step.type === "fields") {
      if (previous && autoAdvances(previous)) step.createManualLap = true;
      previous = step;
      continue;
    }
    const last = step.steps[step.steps.length - 1];
    step.steps.forEach((inner, i) => {
      const before = i === 0 ? [previous, last] : [step.steps[i - 1]];
      if (before.some((p) => p && autoAdvances(p))) inner.createManualLap = true;
    });
    previous = last;
  }
}

function plainText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Un guide par discipline de la séance (un enchaînement en donne plusieurs). */
export function buildGuides(workout: Workout, ctx: GuideContext): GuideBuild[] {
  const multi = workout.segments.length > 1;
  return workout.segments.map((segment, segmentIndex) => {
    const c: Converter = { sport: segment.sport, thresholds: ctx.thresholds, issues: [], once: new Set(), index: 0 };
    const externalId = externalIdFor(ctx.sessionId, segmentIndex);
    const fail = (message: string): GuideBuild => ({
      segmentIndex,
      sport: segment.sport,
      externalId,
      issues: [...c.issues, { severity: "blocking", message }],
      guide: null,
      manifest: null,
    });

    const steps = convertNodes(c, segment.steps);
    markLaps(steps);
    const last = steps[steps.length - 1];
    const lastStep = last?.type === "repeat" ? last.steps[last.steps.length - 1] : last;
    // Étape finale : reste affichée, avec le temps total, jusqu'à l'arrêt de l'enregistrement.
    steps.push({
      type: "fields",
      title: "Fin",
      ...(lastStep && autoAdvances(lastStep) ? { createManualLap: true } : {}),
      fields: [{ type: "text", value: "Séance terminée" }, { type: "duration", title: "TOTAL", window: "workout" }],
      notification: { title: "Fin", text: "Séance terminée, bravo" },
    });
    if (countSteps(steps) > GUIDE_LIMITS.steps) {
      return fail(`Plus de ${GUIDE_LIMITS.steps} étapes une fois les répétitions intérieures déroulées : la montre ne les accepte pas.`);
    }
    if (multi) {
      noteOnce(c, "brick", {
        severity: "info",
        message: "Enchaînement : un guide par discipline, à lancer l'un après l'autre sur la montre.",
      });
    }

    const sportLabel = SPORT_LABELS[segment.sport];
    const suffix = multi ? ` (${segmentIndex + 1}/${workout.segments.length} ${sportLabel.toLowerCase()})` : "";
    const name = `${clip(ctx.title, GUIDE_LIMITS.name - suffix.length).text}${suffix}`;
    const text = [plainText(ctx.description), ctx.nutrition?.trim() ? `Nutrition : ${plainText(ctx.nutrition)}` : ""].filter(Boolean).join(". ");
    const description = clip(text || summarizeNodes(segment.steps, segment.sport), GUIDE_LIMITS.description);
    if (description.clipped) {
      noteOnce(c, "description", {
        severity: "info",
        message: `Description raccourcie à ${GUIDE_LIMITS.description} caractères sur la montre : le texte complet reste dans TriCoach.`,
      });
    }
    const totals = computeTotals({ ...workout, segments: [segment] }, ctx.thresholds);
    const known = totals.duration.status === "exact" || totals.duration.status === "estimated";
    const shortDescription = clip(known && totals.duration.value > 0 ? `${sportLabel}, ${formatDurationShort(totals.duration.value)}` : sportLabel, GUIDE_LIMITS.shortDescription);

    const guide = GuideSchema.safeParse({
      type: "sequence",
      name,
      description: description.text,
      shortDescription: shortDescription.text,
      owner: ctx.owner,
      url: ctx.url,
      usage: "workout",
      localDate: ctx.date,
      externalId,
      ...(ctx.activities?.[segment.sport]?.length ? { activities: ctx.activities[segment.sport] } : {}),
      steps,
    });
    if (!guide.success) return fail(`Guide refusé par le contrôle de format : ${guide.error.issues[0]?.message ?? "format invalide"}.`);
    const manifest = ManifestSchema.parse({ name, type: "sequence", owner: ctx.owner, description: description.text });
    return { segmentIndex, sport: segment.sport, externalId, issues: c.issues, guide: guide.data, manifest };
  });
}
