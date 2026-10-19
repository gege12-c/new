/**
 * ZwiftExporter : fichier de séance Zwift (.zwo), pour le vélo et la course.
 *
 * Format XML de Zwift (pas de spécification officielle publiée ; éléments utilisés : Warmup,
 * Cooldown, SteadyState, IntervalsT, FreeRide, textevent). Intensités en fraction de la FTP
 * (vélo) ou de l'allure de référence 10 km de Zwift (course, attribut pace="2").
 * Import manuel uniquement : Zwift n'offre pas d'API publique d'envoi de séances.
 * Limites Zwift : 250 blocs par séance ; au-delà de 64 Ko, le fichier reste sur l'ordinateur d'import.
 */
import { POWER_ZONES, PACE_ZONES, zoneSpan } from "@/lib/workout/zones";
import { stepQuantities } from "@/lib/workout/compute";
import { describeTarget, formatClock } from "@/lib/workout/format";
import { STEP_TYPE_LABELS, type Repeat, type Segment, type SegmentSport, type Step, type Target, type WorkoutNode } from "@/lib/workout/schema";
import { escapeXml, parseXml, XmlError, type XmlElement } from "./xml";
import { type CompatibilityIssue, type ExportContext, type ValidationResult } from "./types";

export const ZWIFT_MAX_BLOCKS = 250;
export const ZWIFT_SYNC_LIMIT_BYTES = 64 * 1024;
/** Durée retenue pour une étape libre (bouton tour), Zwift exigeant une durée. */
const OPEN_STEP_SECONDS = 300;
const OPEN_STEP_METERS = 1000;
const MAX_MESSAGE = 140;

type Mode = "time" | "distance";

interface Converter {
  sport: "bike" | "run";
  mode: Mode;
  ctx: ExportContext;
  issues: CompatibilityIssue[];
  /** Avertissements déjà émis une fois pour toute la séance. */
  once: Set<string>;
  blocks: string[];
}

const fraction = (percent: number) => Math.round(percent * 10) / 1000;
const num = (value: number) => String(Math.round(value * 1000) / 1000);
const rounded = (value: number) => Math.max(1, Math.round(value));

function where(step: Step, index: number): string {
  return `Étape ${index + 1}, ${step.label || STEP_TYPE_LABELS[step.type]}`;
}

function noteOnce(c: Converter, key: string, issue: CompatibilityIssue) {
  if (c.once.has(key)) return;
  c.once.add(key);
  c.issues.push(issue);
}

/** Intensité en % de la référence Zwift (FTP ou allure seuil), ou null si la cible ne s'y prête pas. */
function intensityRange(c: Converter, step: Step, at: string): { lo: number; hi: number; from: Target } | null {
  const thresholds = c.ctx.thresholds;
  for (const target of step.targets) {
    const key = `${target.metric}.${target.unit}`;
    if (c.sport === "bike") {
      if (key === "power.percent_ftp") return { lo: target.min, hi: target.max, from: target };
      if (key === "power.zone") {
        const span = zoneSpan(POWER_ZONES, target.min, target.max);
        if (!span) continue;
        noteOnce(c, "power-zone", { severity: "info", message: "Zones de puissance converties en % FTP (modèle de Coggan) : Zwift n'utilise pas de zones." });
        return { lo: span.min, hi: span.max, from: target };
      }
      if (key === "power.watts") {
        const ftp = thresholds?.bike?.ftpW;
        if (!ftp) {
          c.issues.push({ severity: "loss", where: at, message: `${describeTarget(target)} : sans FTP enregistrée, impossible de l'exprimer en % FTP pour Zwift ; étape en sortie libre.` });
          return null;
        }
        noteOnce(c, "watts", { severity: "info", message: `Puissances en watts converties en % FTP avec la FTP de l'athlète (${ftp} W).` });
        return { lo: (target.min / ftp) * 100, hi: (target.max / ftp) * 100, from: target };
      }
    } else {
      if (key === "pace.percent_threshold") return { lo: target.min, hi: target.max, from: target };
      if (key === "pace.zone") {
        const span = zoneSpan(PACE_ZONES.run, target.min, target.max);
        if (!span) continue;
        noteOnce(c, "pace-zone", { severity: "info", message: "Zones d'allure converties en % de l'allure seuil." });
        return { lo: span.min, hi: span.max, from: target };
      }
      const threshold = thresholds?.run?.thresholdPaceSPerKm;
      if (key === "pace.sec_per_km" || key === "speed.kmh") {
        if (!threshold) {
          c.issues.push({ severity: "loss", where: at, message: `${describeTarget(target, "run")} : sans allure seuil enregistrée, Zwift ne peut pas suivre cette allure (il la rapporte à une allure de référence).` });
          return null;
        }
        noteOnce(c, "absolute-pace", { severity: "info", message: `Allures converties en % de l'allure seuil de l'athlète (${formatClock(threshold)} /km).` });
        if (key === "pace.sec_per_km") return { lo: (threshold / target.max) * 100, hi: (threshold / target.min) * 100, from: target };
        const thresholdKmh = 3600 / threshold;
        return { lo: (target.min / thresholdKmh) * 100, hi: (target.max / thresholdKmh) * 100, from: target };
      }
    }
  }
  return null;
}

/** Durée (secondes) ou distance (mètres) de l'étape dans l'unité de la séance Zwift. */
function lengthFor(c: Converter, step: Step, at: string): number | null {
  const length = step.length;
  if (length.unit === "open") {
    const value = c.mode === "time" ? OPEN_STEP_SECONDS : OPEN_STEP_METERS;
    c.issues.push({
      severity: "loss",
      where: at,
      message: `Étape libre (jusqu'au bouton tour) : Zwift exige une ${c.mode === "time" ? "durée, 5 min retenues" : "distance, 1 km retenu"}.`,
    });
    return value;
  }
  if (length.unit === "reps") {
    c.issues.push({ severity: "blocking", where: at, message: "Étape en répétitions : impossible dans Zwift." });
    return null;
  }
  if (c.mode === "time" && length.unit === "time") return length.seconds;
  if (c.mode === "distance" && length.unit === "distance") return length.meters;
  const quantities = stepQuantities(step, c.sport, c.ctx.thresholds);
  if (c.mode === "time") {
    const seconds = quantities.duration.value;
    if (seconds === null) {
      c.issues.push({
        severity: "blocking",
        where: at,
        message: `Étape de ${length.unit === "distance" ? `${Math.round(length.meters)} m` : "distance"} : Zwift ${c.sport === "bike" ? "vélo ne compte qu'en durée" : "attend ici une durée"}, et sa durée n'est pas calculable (ajoutez une cible d'allure ou les seuils de l'athlète).`,
      });
      return null;
    }
    c.issues.push({ severity: "loss", where: at, message: `Distance convertie en durée estimée : ${Math.round(seconds / 60)} min (d'après les seuils de l'athlète).` });
    return seconds;
  }
  const meters = quantities.distance.value;
  if (meters === null) {
    c.issues.push({ severity: "blocking", where: at, message: "Étape en durée dans une séance de course en distance : distance non calculable (ajoutez une cible d'allure ou les seuils de l'athlète)." });
    return null;
  }
  c.issues.push({ severity: "loss", where: at, message: `Durée convertie en distance estimée : ${Math.round(meters)} m (d'après les seuils de l'athlète).` });
  return meters;
}

/** Cadence vélo (attribut Cadence) : une seule valeur, le centre de la plage. */
function cadenceFor(c: Converter, step: Step, at: string): number | null {
  const cadence = step.targets.find((t) => t.metric === "cadence");
  if (!cadence) return null;
  if (c.sport !== "bike" || cadence.unit !== "rpm") {
    c.issues.push({ severity: "loss", where: at, message: `${describeTarget(cadence, c.sport)} : cible de cadence non reprise par Zwift en course.` });
    return null;
  }
  const mid = Math.round((cadence.min + cadence.max) / 2);
  if (cadence.min !== cadence.max) c.issues.push({ severity: "loss", where: at, message: `Cadence ${cadence.min}–${cadence.max} tr/min ramenée à ${mid} tr/min (Zwift n'affiche qu'une valeur).` });
  return mid;
}

/** Texte affiché pendant l'étape : intitulé, consignes, cibles que Zwift ne sait pas suivre. */
function messageFor(c: Converter, step: Step, at: string, used: Target | null): string | null {
  const ignored = step.targets.filter((t) => t !== used && t.metric !== "cadence");
  for (const target of ignored) {
    c.issues.push({ severity: "loss", where: at, message: `${describeTarget(target, c.sport)} : cible non suivie par Zwift, affichée en consigne.` });
  }
  const parts = [step.label, ...ignored.map((t) => describeTarget(t, c.sport)), step.notes].filter((p): p is string => Boolean(p && p.trim()));
  if (!parts.length) return null;
  const message = parts.join(" — ").replace(/\s+/g, " ").trim();
  if (message.length <= MAX_MESSAGE) return message;
  c.issues.push({ severity: "loss", where: at, message: "Consigne raccourcie à l'écran de Zwift (140 caractères)." });
  return `${message.slice(0, MAX_MESSAGE - 1)}…`;
}

function attrs(values: Record<string, string | number | null | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
}

type TextEvent = { offset: number; message: string };

function element(name: string, attributes: Record<string, string | number | null | undefined>, message: string | null | TextEvent[]): string {
  const open = `<${name}${attrs(attributes)}`;
  const events = typeof message === "string" ? [{ offset: 0, message }] : (message ?? []);
  if (!events.length) return `${open}/>`;
  const lines = events.map((e) => `            <textevent timeoffset="${e.offset}" message="${escapeXml(e.message)}"/>`);
  return `${open}>\n${lines.join("\n")}\n        </${name}>`;
}

interface ConvertedStep {
  length: number;
  range: { lo: number; hi: number } | null;
  cadence: number | null;
  message: string | null;
}

function convertStep(c: Converter, step: Step, at: string): ConvertedStep | null {
  if (step.sendOffSeconds) c.issues.push({ severity: "loss", where: at, message: "Départ (send-off) non repris par Zwift." });
  if (step.equipment?.length) noteOnce(c, "equipment", { severity: "loss", message: "Matériel non affiché par Zwift." });
  const length = lengthFor(c, step, at);
  const range = intensityRange(c, step, at);
  const cadence = cadenceFor(c, step, at);
  const message = messageFor(c, step, at, range?.from ?? null);
  if (length === null) return null;
  return { length: rounded(length), range: range ? { lo: range.lo, hi: range.hi } : null, cadence, message };
}

/**
 * Plage effective : une borne basse à 0 (« moins de 55 % », zone 1) n'a pas de sens comme consigne
 * Zwift ; on retient alors le haut de la plage (80 à 100 % de la borne haute).
 */
function effective(range: { lo: number; hi: number }): { lo: number; hi: number } {
  return range.lo > 0 ? range : { lo: range.hi * 0.8, hi: range.hi };
}

const midpoint = (range: { lo: number; hi: number }) => {
  const r = effective(range);
  return fraction((r.lo + r.hi) / 2);
};

function noteSingleValue(c: Converter, at: string, range: { lo: number; hi: number }) {
  if (range.lo === range.hi) return;
  c.issues.push({
    severity: "loss",
    where: at,
    message: `Plage ${Math.round(range.lo)}–${Math.round(range.hi)} % ramenée à ${Math.round(midpoint(range) * 1000) / 10} % (Zwift vise une valeur unique).`,
  });
}

/** Course sans allure : Zwift exige une intensité. Hypothèse « allure facile » pour les étapes faciles. */
const EASY_RUN_STEPS = new Set(["warmup", "cooldown", "recovery", "rest", "drill"]);

function pushStep(c: Converter, step: Step, index: number) {
  const at = where(step, index);
  if (c.sport === "run" && step.type === "transition") {
    noteOnce(c, "transition", { severity: "info", message: "Transition non exportée : la séance Zwift commence directement par la course." });
    return;
  }
  const converted = convertStep(c, step, at);
  if (!converted) return;
  const { length, range, cadence, message } = converted;
  const pace = c.sport === "run" ? { pace: 2 } : {};
  const durationKey = { Duration: length };
  if (!range) {
    if (c.sport === "bike") {
      noteOnce(c, "free-ride", { severity: "info", message: "Étapes sans cible de puissance exportées en sortie libre (FreeRide)." });
      c.blocks.push(element("FreeRide", { ...durationKey, Cadence: cadence }, message));
      return;
    }
    const hasPace = step.targets.some((t) => t.metric === "pace" || t.metric === "speed");
    if (!EASY_RUN_STEPS.has(step.type)) {
      c.issues.push({
        severity: "blocking",
        where: at,
        message: hasPace
          ? "Zwift exige une intensité en course : enregistrez l'allure seuil de l'athlète dans son profil sportif, ou exprimez cette allure en % de l'allure seuil."
          : "Zwift exige une intensité en course : ajoutez une cible d'allure ou de vitesse à cette étape de travail.",
      });
      return;
    }
    c.issues.push({
      severity: "loss",
      where: at,
      message: "Zwift exige une intensité en course : 80 % de l'allure de référence retenus pour cette étape facile.",
    });
    c.blocks.push(element("SteadyState", { ...durationKey, Power: num(0.8), ...pace }, message));
    return;
  }
  const r = effective(range);
  const lo = fraction(r.lo);
  const hi = fraction(r.hi);
  if (step.type === "warmup" && lo < hi) {
    noteOnce(c, "ramp-up", { severity: "info", message: "Échauffement exporté en rampe progressive, du bas vers le haut de la plage." });
    c.blocks.push(element("Warmup", { ...durationKey, PowerLow: num(lo), PowerHigh: num(hi), ...pace, Cadence: cadence }, message));
    return;
  }
  if (step.type === "cooldown" && lo < hi) {
    noteOnce(c, "ramp-down", { severity: "info", message: "Retour au calme exporté en rampe dégressive, du haut vers le bas de la plage." });
    c.blocks.push(element("Cooldown", { ...durationKey, PowerLow: num(hi), PowerHigh: num(lo), ...pace, Cadence: cadence }, message));
    return;
  }
  noteSingleValue(c, at, range);
  c.blocks.push(element("SteadyState", { ...durationKey, Power: num(midpoint(range)), ...pace, Cadence: cadence }, message));
}

/** Répétition de deux étapes avec cible : un bloc IntervalsT de Zwift. */
function pushIntervals(c: Converter, repeat: Repeat, on: Step, off: Step, index: number): boolean {
  if (c.sport === "run" && (on.type === "transition" || off.type === "transition")) return false;
  const issuesBefore = c.issues.length;
  const onceBefore = new Set(c.once);
  const onAt = where(on, index);
  const offAt = where(off, index + 1);
  const onConverted = convertStep(c, on, onAt);
  const offConverted = convertStep(c, off, offAt);
  if (!onConverted || !offConverted || !onConverted.range || !offConverted.range) {
    // Repli sur le déroulé : les écarts seront recalculés étape par étape.
    c.issues.length = issuesBefore;
    c.once = onceBefore;
    return false;
  }
  noteSingleValue(c, onAt, onConverted.range);
  noteSingleValue(c, offAt, offConverted.range);
  const events: TextEvent[] = [];
  const onMessage = [repeat.label, onConverted.message].filter(Boolean).join(" — ");
  if (onMessage) events.push({ offset: 0, message: onMessage.slice(0, MAX_MESSAGE) });
  if (offConverted.message) events.push({ offset: onConverted.length, message: offConverted.message });
  c.blocks.push(
    element(
      "IntervalsT",
      {
        Repeat: repeat.count,
        OnDuration: onConverted.length,
        OffDuration: offConverted.length,
        OnPower: num(midpoint(onConverted.range)),
        OffPower: num(midpoint(offConverted.range)),
        ...(c.sport === "run" ? { pace: 2 } : {}),
        Cadence: onConverted.cadence,
        CadenceResting: offConverted.cadence,
      },
      events,
    ),
  );
  return true;
}

function walk(c: Converter, nodes: WorkoutNode[], counter: { index: number }) {
  for (const node of nodes) {
    if (node.kind === "step") {
      pushStep(c, node, counter.index);
      counter.index += 1;
      continue;
    }
    const [first, second] = node.steps;
    if (node.steps.length === 2 && first.kind === "step" && second.kind === "step" && pushIntervals(c, node, first, second, counter.index)) {
      counter.index += 2;
      continue;
    }
    noteOnce(c, "unrolled", { severity: "info", message: "Répétitions déroulées bloc par bloc (Zwift n'alterne que deux étapes par série)." });
    const start = counter.index;
    for (let i = 0; i < node.count; i += 1) {
      counter.index = start;
      walk(c, node.steps, counter);
    }
  }
}

function lengthUnits(nodes: WorkoutNode[]): Set<string> {
  const units = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "step") units.add(node.length.unit);
    else lengthUnits(node.steps).forEach((u) => units.add(u));
  }
  return units;
}

export interface ZwoResult {
  xml: string | null;
  issues: CompatibilityIssue[];
  blocks: number;
}

/** Convertit un segment (vélo ou course) en fichier .zwo, avec la liste précise des écarts. */
export function buildZwo(segment: Segment, ctx: ExportContext): ZwoResult {
  const sport: SegmentSport = segment.sport;
  if (sport !== "bike" && sport !== "run") {
    return { xml: null, blocks: 0, issues: [{ severity: "blocking", message: "Zwift ne propose que le vélo et la course à pied." }] };
  }
  const units = lengthUnits(segment.steps);
  const mode: Mode = sport === "run" && units.has("distance") && !units.has("time") ? "distance" : "time";
  const c: Converter = { sport, mode, ctx, issues: [], once: new Set(), blocks: [] };
  if (sport === "run") {
    c.issues.push({
      severity: "info",
      message: "Zwift calcule les allures à partir de l'allure 10 km enregistrée dans votre profil Zwift : vérifiez qu'elle correspond à votre allure seuil.",
    });
  }
  walk(c, segment.steps, { index: 0 });
  if (c.blocks.length > ZWIFT_MAX_BLOCKS) {
    c.issues.push({ severity: "blocking", message: `${c.blocks.length} blocs une fois les répétitions déroulées : Zwift en accepte ${ZWIFT_MAX_BLOCKS} au plus.` });
  }
  if (c.issues.some((i) => i.severity === "blocking")) return { xml: null, blocks: c.blocks.length, issues: c.issues };

  const description = [segment.goal, ctx.description].filter(Boolean).join("\n\n").slice(0, 2000);
  const lines = [
    "<workout_file>",
    `    <author>${escapeXml(ctx.author || "TriCoach")}</author>`,
    `    <name>${escapeXml(ctx.title.slice(0, 100))}</name>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <sportType>${sport}</sportType>`,
    ...(sport === "run" ? [`    <durationType>${mode}</durationType>`] : []),
    "    <tags>",
    '        <tag name="TriCoach"/>',
    "    </tags>",
    "    <workout>",
    ...c.blocks.map((block) => `        ${block}`),
    "    </workout>",
    "</workout_file>",
    "",
  ];
  const xml = lines.join("\n");
  if (new TextEncoder().encode(xml).length > ZWIFT_SYNC_LIMIT_BYTES) {
    c.issues.push({ severity: "loss", message: "Fichier de plus de 64 Ko : Zwift ne le synchronise pas, il reste sur l'ordinateur d'import." });
  }
  return { xml, blocks: c.blocks.length, issues: c.issues };
}

const BLOCKS = new Set(["Warmup", "Cooldown", "SteadyState", "IntervalsT", "FreeRide", "Ramp", "MaxEffort"]);
const POWER_ATTRIBUTES = ["Power", "PowerLow", "PowerHigh", "OnPower", "OffPower"];
const DURATION_ATTRIBUTES = ["Duration", "OnDuration", "OffDuration"];

export interface ZwoSummary {
  sportType: string;
  durationType: Mode;
  blocks: number;
  /** Somme des durées (secondes) ou distances (mètres), répétitions comprises. */
  total: number;
}

/** Relit un fichier .zwo et contrôle sa structure ; renvoie un résumé pour comparaison. */
export function validateZwo(xml: string): ValidationResult & { summary?: ZwoSummary } {
  const errors: string[] = [];
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    return { ok: false, errors: [error instanceof XmlError ? error.message : "XML illisible"] };
  }
  if (root.name !== "workout_file") errors.push("Élément racine workout_file attendu");
  const child = (name: string) => root.children.find((c) => c.name === name);
  if (!child("name")?.text) errors.push("Nom de séance manquant");
  const sportType = child("sportType")?.text ?? "";
  if (sportType !== "bike" && sportType !== "run") errors.push(`sportType inconnu : ${sportType || "absent"}`);
  const durationType = (child("durationType")?.text || "time") as Mode;
  if (durationType !== "time" && durationType !== "distance") errors.push(`durationType inconnu : ${durationType}`);
  const workout = child("workout");
  if (!workout || !workout.children.length) errors.push("Séance vide");
  let total = 0;
  for (const block of workout?.children ?? []) {
    if (!BLOCKS.has(block.name)) {
      errors.push(`Bloc inconnu : ${block.name}`);
      continue;
    }
    for (const key of DURATION_ATTRIBUTES) {
      if (key in block.attributes && !(Number.isInteger(Number(block.attributes[key])) && Number(block.attributes[key]) > 0)) {
        errors.push(`${block.name} : ${key} invalide (${block.attributes[key]})`);
      }
    }
    for (const key of POWER_ATTRIBUTES) {
      if (key in block.attributes) {
        const value = Number(block.attributes[key]);
        if (!(value > 0 && value <= 5)) errors.push(`${block.name} : ${key} invalide (${block.attributes[key]})`);
      }
    }
    if ("Cadence" in block.attributes && !(Number(block.attributes.Cadence) >= 20 && Number(block.attributes.Cadence) <= 200)) {
      errors.push(`${block.name} : Cadence invalide`);
    }
    if (block.name === "IntervalsT") {
      const repeat = Number(block.attributes.Repeat);
      if (!(Number.isInteger(repeat) && repeat >= 1 && repeat <= 100)) errors.push("IntervalsT : Repeat invalide");
      total += repeat * (Number(block.attributes.OnDuration) + Number(block.attributes.OffDuration));
    } else {
      if (!("Duration" in block.attributes)) errors.push(`${block.name} : Duration manquante`);
      total += Number(block.attributes.Duration);
    }
    for (const event of block.children) {
      if (event.name !== "textevent") errors.push(`Élément inattendu dans ${block.name} : ${event.name}`);
      else if (!event.attributes.message || !(Number(event.attributes.timeoffset) >= 0)) errors.push("textevent invalide");
    }
  }
  const blocks = workout?.children.length ?? 0;
  if (blocks > ZWIFT_MAX_BLOCKS) errors.push(`Plus de ${ZWIFT_MAX_BLOCKS} blocs`);
  return { ok: errors.length === 0, errors, summary: { sportType, durationType, blocks, total } };
}
