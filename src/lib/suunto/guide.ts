/**
 * Conversion d'une partie de séance TriCoach en guide SuuntoPlus (`guide.json`), avec le contrôle
 * de compatibilité : tout ce que la montre ne portera pas est dit, rien n'est inventé.
 *
 * Format Suunto (apizone.suunto.com/suuntoplus-guide-description) : une « sequence » d'étapes.
 * Chaque étape affiche jusqu'à cinq champs (le premier en plus gros) : cible avec jauge
 * (targetPace, targetHeartRate, targetPower, targetSpeed, targetCadence), mesures en direct (pace,
 * heartRate, power, speed), compte à rebours de l'étape, texte. Elle passe à la suivante sur une
 * condition (durée, distance ou bouton tour) et peut vibrer avec une notification au départ.
 * Une répétition (« repeat ») ne peut pas en contenir une autre.
 *
 * Unités Suunto : allure et vitesse en m/s, cadence en hertz, durées en secondes, distances en mètres.
 * Limites : titre d'étape 13 caractères, notification 54, champ texte 54 (au-delà de 40 il masque
 * les autres champs), nom du guide 60, description 256, « shortDescription » 23, 1 000 étapes.
 */
import type { CompatibilityIssue } from "@/lib/export/types";
import { resolveTarget, type MissingThreshold, type ResolvedTarget } from "@/lib/workout/compute";
import { describeTarget, formatClock, formatDistance, formatDuration } from "@/lib/workout/format";
import {
  EQUIPMENT_LABELS,
  STEP_TYPE_LABELS,
  type Segment,
  type SegmentSport,
  type Step,
  type StepType,
  type Target,
  type WorkoutNode,
} from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { buildIconPng, buildZip } from "./zip";

export interface GuideOptions {
  /** Titre de la séance (nom du guide, 60 caractères). */
  title: string;
  description?: string | null;
  /** Date locale de la séance (yyyy-MM-dd) : la montre propose le guide ce jour-là. */
  date: string;
  /** Nom de l'application sur l'APIZone : exigé par Suunto comme propriétaire du guide. */
  owner: string;
  /** Lien vers la séance dans TriCoach (champ `url` du guide). */
  url: string;
  /** Identifiant stable, repris dans le fichier FIT de l'activité réalisée. */
  externalId: string;
  thresholds?: AthleteThresholds;
  /** Modes sportifs Suunto auxquels limiter le guide ; vide = tous. */
  activities?: number[];
}

export interface SuuntoGuide {
  type: "sequence";
  name: string;
  description: string;
  shortDescription: string;
  owner: string;
  url: string;
  usage: "workout";
  localDate: string;
  externalId: string;
  activities?: number[];
  steps: GuideNode[];
}

export type GuideField = Record<string, unknown> & { type: string };
export interface GuideStep {
  type: "fields";
  title: string;
  fields: GuideField[];
  notification?: { title: string; text: string };
  transitions?: { condition: { type: string; value?: number } }[];
  createManualLap?: boolean;
}
export interface GuideRepeat {
  type: "repeat";
  times: number;
  steps: GuideStep[];
}
export type GuideNode = GuideStep | GuideRepeat;

export interface GuideBuild {
  guide: SuuntoGuide;
  issues: CompatibilityIssue[];
  /** Étapes écrites (une étape d'une répétition compte une fois). */
  steps: number;
}

const LIMITS = {
  name: 60,
  description: 256,
  short: 23,
  stepTitle: 13,
  notification: 54,
  text: 54,
  textWithSiblings: 40,
  steps: 1000,
  repeat: 100,
};

const trunc = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clean = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() || "";

/** Titres d'étape sur la montre (13 caractères, sans accent pour la lisibilité des petites polices). */
const STEP_TITLES: Record<StepType, string> = {
  warmup: "ECHAUF",
  active: "TRAVAIL",
  drill: "EDUCATIF",
  recovery: "RECUP",
  rest: "REPOS",
  transition: "TRANSITION",
  cooldown: "RETOUR",
};

const MISSING: Record<Exclude<MissingThreshold, "unsupported">, string> = {
  bike_ftp: "FTP vélo non renseignée : les cibles en % FTP ou en zones de puissance sont envoyées sans valeur en watts.",
  bike_lthr: "FC au seuil vélo non renseignée : les cibles cardiaques relatives sont envoyées sans valeur en bpm.",
  run_lthr: "FC au seuil course non renseignée : les cibles cardiaques relatives sont envoyées sans valeur en bpm.",
  max_hr: "FC maximale non renseignée : les cibles en % FC max sont envoyées sans valeur en bpm.",
  run_threshold_pace: "Allure seuil course non renseignée : les allures relatives sont envoyées sans valeur absolue.",
  swim_css: "CSS natation non renseignée : les allures relatives sont envoyées sans valeur absolue.",
};

/** Champ cible Suunto (jauge) ; null pour l'effort ressenti, que la montre ne mesure pas. */
export function targetField(target: ResolvedTarget): GuideField | null {
  switch (target.metric) {
    case "power":
      return {
        type: "targetPower",
        value: round3((target.min + target.max) / 2),
        min: round3(target.min),
        max: round3(target.max),
      };
    case "heart_rate":
      return {
        type: "targetHeartRate",
        value: Math.round((target.min + target.max) / 2),
        min: Math.round(target.min),
        max: Math.round(target.max),
      };
    case "pace": {
      // Allure : `min` est la borne rapide (moins de secondes), donc la vitesse la plus haute.
      const perMeter = target.unit === "sec_per_km" ? 1000 : 100;
      const fast = perMeter / target.min;
      const slow = perMeter / target.max;
      return {
        type: "targetPace",
        value: round3((fast + slow) / 2),
        min: round3(slow),
        max: round3(fast),
      };
    }
    case "speed":
      return {
        type: "targetSpeed",
        value: round3((target.min + target.max) / 2 / 3.6),
        min: round3(target.min / 3.6),
        max: round3(target.max / 3.6),
      };
    case "cadence":
      return {
        type: "targetCadence",
        value: round3((target.min + target.max) / 2 / 60),
        min: round3(target.min / 60),
        max: round3(target.max / 60),
      };
    case "rpe":
      return null;
  }
}

/** Mesure en direct qui accompagne la cible, selon la discipline. */
function liveField(sport: SegmentSport, metric: ResolvedTarget["metric"] | null): GuideField {
  if (metric === "power") return { type: "power", title: "PUISS" };
  if (metric === "heart_rate") return { type: "heartRate", title: "FC" };
  if (metric === "cadence") return { type: "cadence", title: "CAD" };
  if (metric === "speed") return { type: "speed", title: "VIT" };
  if (sport === "run" || sport === "swim") return { type: "pace", title: "ALLURE" };
  if (sport === "bike") return { type: "speed", title: "VIT" };
  return { type: "heartRate", title: "FC" };
}

function targetText(target: Target, sport: SegmentSport): string {
  return target.metric === "rpe" ? `Effort ${target.min === target.max ? target.min : `${target.min}-${target.max}`}/10` : describeTarget(target, sport);
}

function stepTitle(step: Step, index: number, total: number): string {
  const label = clean(step.label);
  if (label) return trunc(label.toUpperCase(), LIMITS.stepTitle);
  const base = STEP_TITLES[step.type];
  return trunc(total > 1 ? `${base} ${index}/${total}` : base, LIMITS.stepTitle);
}

interface StepContext {
  sport: SegmentSport;
  thresholds?: AthleteThresholds;
  index: number;
  total: number;
  /** L'étape précédente passe-t-elle automatiquement (durée ou distance) ? */
  afterAutoAdvance: boolean;
  issues: CompatibilityIssue[];
  missing: Set<string>;
  where: string;
}

function buildStep(step: Step, ctx: StepContext): GuideStep {
  const fields: GuideField[] = [];
  const notes: string[] = [];
  let primary: ResolvedTarget | null = null;

  for (const target of step.targets) {
    const resolution = resolveTarget(target, ctx.sport, ctx.thresholds);
    if (!resolution.ok) {
      if (resolution.missing !== "unsupported") ctx.missing.add(MISSING[resolution.missing]);
      notes.push(targetText(target, ctx.sport));
      ctx.issues.push({
        severity: "loss",
        where: ctx.where,
        message: `Cible « ${targetText(target, ctx.sport)} » sans valeur absolue : écrite en texte sur la montre, sans jauge.`,
      });
      continue;
    }
    const field = targetField(resolution.target);
    if (!field) {
      notes.push(targetText(target, ctx.sport));
      ctx.issues.push({
        severity: "loss",
        where: ctx.where,
        message: "Effort ressenti : la montre ne le mesure pas, il est écrit en texte.",
      });
    } else if (primary) {
      notes.push(describeTarget(target, ctx.sport));
      ctx.issues.push({
        severity: "loss",
        where: ctx.where,
        message: `Une seule cible avec jauge par étape sur la montre : « ${describeTarget(target, ctx.sport)} » est écrite en texte.`,
      });
    } else {
      primary = resolution.target;
      fields.push({ ...field, title: "CIBLE" });
      if (resolution.target.metric === "cadence") {
        ctx.issues.push({
          severity: "info",
          where: ctx.where,
          message: "Cadence convertie en hertz pour la montre (90 rpm = 1,5 Hz).",
        });
      }
    }
  }
  fields.push(liveField(ctx.sport, primary?.metric ?? null));

  let transition: GuideStep["transitions"];
  let endText: string;
  switch (step.length.unit) {
    case "time":
      fields.push({
        type: "stepDurationCountdown",
        value: step.length.seconds,
        title: "RESTE",
      });
      transition = [{ condition: { type: "stepDuration", value: step.length.seconds } }];
      endText = formatDuration(step.length.seconds);
      break;
    case "distance":
      fields.push({
        type: "stepDistanceCountdown",
        value: step.length.meters,
        title: "RESTE",
      });
      transition = [{ condition: { type: "stepDistance", value: step.length.meters } }];
      endText = formatDistance(step.length.meters, ctx.sport);
      break;
    case "reps":
      fields.push({ type: "duration", window: "step", title: "TEMPS" });
      transition = [{ condition: { type: "manualLap" } }];
      endText = `${step.length.reps} rép.`;
      notes.unshift(`${step.length.reps} répétitions, puis bouton tour`);
      ctx.issues.push({
        severity: "info",
        where: ctx.where,
        message: `${step.length.reps} répétitions : la montre ne les compte pas, l'étape se termine au bouton tour.`,
      });
      break;
    case "open":
      fields.push({ type: "duration", window: "step", title: "TEMPS" });
      transition = [{ condition: { type: "manualLap" } }];
      endText = "Bouton tour";
      break;
  }

  if (primary?.metric !== "heart_rate") fields.push({ type: "heartRate", title: "FC" });

  if (step.sendOffSeconds) {
    notes.push(`Départ toutes les ${formatClock(step.sendOffSeconds)}`);
    ctx.issues.push({
      severity: "loss",
      where: ctx.where,
      message: "Départ (send-off) : la montre ne le chronomètre pas, il est écrit en texte.",
    });
  }
  if (step.equipment?.length) {
    const list = step.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ");
    notes.push(`Matériel : ${list}`);
    ctx.issues.push({
      severity: "info",
      where: ctx.where,
      message: `Matériel (${list}) écrit en texte sur l'étape.`,
    });
  }
  const coachNotes = clean(step.notes);
  if (coachNotes) {
    notes.push(coachNotes);
    if (coachNotes.length > LIMITS.textWithSiblings) {
      ctx.issues.push({
        severity: "loss",
        where: ctx.where,
        message: `Consigne coupée à ${LIMITS.textWithSiblings} caractères sur la montre (la notification de départ en garde ${LIMITS.notification}).`,
      });
    }
  }

  const text = notes.join(" · ");
  if (text) fields.push({ type: "text", value: trunc(text, LIMITS.textWithSiblings) });

  const title = stepTitle(step, ctx.index, ctx.total);
  const targetLine = primary ? describeTarget(step.targets.find((t) => resolveTarget(t, ctx.sport, ctx.thresholds).ok) ?? step.targets[0], ctx.sport) : "";
  const notification = trunc([endText, targetLine, text].filter(Boolean).join(" · "), LIMITS.notification);

  const built: GuideStep = {
    type: "fields",
    title,
    fields: fields.slice(0, 5),
    notification: { title, text: notification || title },
    transitions: transition,
  };
  // Après un passage automatique, la montre ne pose pas de tour : on en crée un au départ de l'étape
  // pour que chaque étape ait le sien. Après un appui sur le bouton tour, elle l'a déjà fait.
  if (ctx.afterAutoAdvance) built.createManualLap = true;
  return built;
}

const isAuto = (step: Step) => step.length.unit === "time" || step.length.unit === "distance";

/** Déroule les répétitions imbriquées (Suunto n'accepte qu'un niveau). */
function flattenSteps(nodes: WorkoutNode[]): Step[] {
  return nodes.flatMap((node) => (node.kind === "step" ? [node] : Array.from({ length: node.count }, () => flattenSteps(node.steps)).flat()));
}

export function buildGuide(segment: Segment, options: GuideOptions): GuideBuild {
  const issues: CompatibilityIssue[] = [];
  const missing = new Set<string>();
  const steps: GuideNode[] = [];
  let prevAuto = false;
  let count = 0;
  let position = 0;

  const context = (where: string, index: number, total: number, afterAutoAdvance: boolean): StepContext => ({
    sport: segment.sport,
    thresholds: options.thresholds,
    index,
    total,
    afterAutoAdvance,
    issues,
    missing,
    where,
  });

  for (const node of segment.steps) {
    position += 1;
    if (node.kind === "step") {
      steps.push(buildStep(node, context(`Étape ${position}, ${STEP_TYPE_LABELS[node.type]}`, 1, 1, prevAuto)));
      prevAuto = isAuto(node);
      count += 1;
      continue;
    }
    if (node.steps.some((inner) => inner.kind === "repeat")) {
      issues.push({
        severity: "info",
        where: `Étape ${position}, répétition`,
        message: "Répétition dans une répétition : déroulée en étapes successives, la montre n'accepte qu'un niveau.",
      });
    }
    const inner = flattenSteps(node.steps);
    const lastAuto = isAuto(inner[inner.length - 1]);
    const times = Math.min(node.count, LIMITS.repeat);
    if (node.count > LIMITS.repeat) {
      issues.push({
        severity: "loss",
        where: `Étape ${position}, répétition`,
        message: `${node.count} répétitions demandées : la montre s'arrête à ${LIMITS.repeat}.`,
      });
    }
    const built = inner.map((step, i) =>
      buildStep(
        step,
        context(`Étape ${position}, répétition ${i + 1}/${inner.length}`, i + 1, inner.length, i === 0 ? prevAuto || lastAuto : isAuto(inner[i - 1])),
      ),
    );
    if (times > 1) steps.push({ type: "repeat", times, steps: built });
    else steps.push(...built);
    prevAuto = lastAuto;
    count += built.length;
  }

  steps.push({
    type: "fields",
    title: "FIN",
    fields: [
      { type: "text", value: "Séance terminée, bravo" },
      { type: "duration", window: "workout", title: "TOTAL" },
    ],
    notification: { title: "FIN", text: "Séance terminée, bravo" },
  });
  count += 1;

  for (const message of missing) issues.push({ severity: "loss", message });
  if (count > LIMITS.steps)
    issues.push({
      severity: "blocking",
      message: `La séance compte ${count} étapes, la montre en accepte ${LIMITS.steps} au plus.`,
    });

  const title = clean(options.title) || "Séance";
  const description = clean(options.description) || summarizeSegment(segment, options.thresholds);
  const guide: SuuntoGuide = {
    type: "sequence",
    name: trunc(title, LIMITS.name),
    description: trunc(description, LIMITS.description) || title,
    shortDescription: trunc(title, LIMITS.short),
    owner: options.owner,
    url: options.url,
    usage: "workout",
    localDate: options.date,
    externalId: trunc(options.externalId, 64),
    steps,
  };
  if (options.activities?.length) guide.activities = options.activities.slice(0, 100);
  return { guide, issues, steps: count };
}

/** Résumé d'une partie de séance, pour la description du guide quand le coach n'en a pas écrit. */
export function summarizeSegment(segment: Segment, thresholds?: AthleteThresholds): string {
  const one = (step: Step): string => {
    const length =
      step.length.unit === "time"
        ? formatDuration(step.length.seconds)
        : step.length.unit === "distance"
          ? formatDistance(step.length.meters, segment.sport)
          : step.length.unit === "reps"
            ? `${step.length.reps} rép.`
            : "libre";
    const target = step.targets[0];
    const resolved = target ? resolveTarget(target, segment.sport, thresholds) : null;
    const tgt = target ? (resolved?.ok ? describeTarget(target, segment.sport) : targetText(target, segment.sport)) : "";
    return [length, clean(step.label) || STEP_TITLES[step.type].toLowerCase(), tgt ? `@ ${tgt}` : ""].filter(Boolean).join(" ");
  };
  return segment.steps.map((node) => (node.kind === "step" ? one(node) : `${node.count}×(${flattenSteps(node.steps).map(one).join(", ")})`)).join(" · ");
}

/** Le ZIP prêt à envoyer à Suunto (guide.json, manifest.json, icon.png). */
export function buildGuidePackage(segment: Segment, options: GuideOptions): GuideBuild & { zip: Uint8Array } {
  const build = buildGuide(segment, options);
  const manifest = {
    name: build.guide.name,
    type: "sequence",
    owner: options.owner,
    description: build.guide.description,
  };
  const encoder = new TextEncoder();
  const zip = buildZip([
    { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) },
    { name: "guide.json", data: encoder.encode(JSON.stringify(build.guide)) },
    { name: "icon.png", data: buildIconPng() },
  ]);
  return { ...build, zip };
}
