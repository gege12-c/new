/**
 * GarminConnector : fichier FIT de type « séance » (workout), et non d'activité, écrit avec le SDK
 * FIT officiel de Garmin (@garmin/fitsdk) puis relu avec ce même SDK pour validation.
 *
 * Structure : file_id (type workout), workout (nom, sport, nombre d'étapes), workout_step × N.
 * Les répétitions sont des étapes « repeat until steps complete » qui renvoient à l'index de la
 * première étape répétée ; les répétitions imbriquées sont déroulées (prise en charge inégale selon
 * les appareils). Valeurs brutes des champs principaux (le SDK n'écrit pas les sous-champs) :
 * durée en ms, distance en cm, puissance en % FTP (0–1000) ou watts + 1000, FC en % FC max (0–100)
 * ou bpm + 100, vitesse en mm/s, cadence en tr/min.
 */
import { Decoder, Encoder, Profile, Stream, type FileIdMesg, type WorkoutMesg, type WorkoutStepMesg } from "@garmin/fitsdk";
import { describeTarget, formatClock } from "@/lib/workout/format";
import {
  EQUIPMENT_LABELS,
  STEP_TYPE_LABELS,
  type Equipment,
  type Segment,
  type SegmentSport,
  type Step,
  type StepType,
  type Target,
  type WorkoutNode,
} from "@/lib/workout/schema";
import { hrZonesFor, lthrFor, paceZonesFor, POWER_ZONES, thresholdSecondsPerMeter, zoneSpan } from "@/lib/workout/zones";
import { type CompatibilityIssue, type ExportContext, type ValidationResult } from "./types";

/** Au-delà, certains appareils refusent la séance : on prévient sans bloquer. */
export const FIT_STEP_WARNING = 50;
const MAX_NAME_BYTES = 60;
const MAX_STEP_NAME_BYTES = 50;
const MAX_NOTES_BYTES = 250;

const SPORTS: Record<SegmentSport, { sport: string; subSport: string }> = {
  bike: { sport: "cycling", subSport: "generic" },
  run: { sport: "running", subSport: "generic" },
  swim: { sport: "swimming", subSport: "lapSwimming" },
  strength: { sport: "training", subSport: "strengthTraining" },
  other: { sport: "generic", subSport: "generic" },
};

const INTENSITY: Record<StepType, string> = {
  warmup: "warmup",
  active: "active",
  recovery: "recovery",
  rest: "rest",
  cooldown: "cooldown",
  drill: "active",
  transition: "other",
};

const EQUIPMENT: Partial<Record<Equipment, string>> = {
  fins: "swimFins",
  kickboard: "swimKickboard",
  paddles: "swimPaddles",
  pull_buoy: "swimPullBuoy",
  snorkel: "swimSnorkel",
};

const encoder = new TextEncoder();

/** Tronque un texte à une taille UTF-8 (les champs FIT sont limités à 255 octets). */
export function clipUtf8(text: string, maxBytes: number): { text: string; clipped: boolean } {
  if (encoder.encode(text).length <= maxBytes) return { text, clipped: false };
  let out = "";
  let size = 0;
  for (const char of text) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > maxBytes - 3) break;
    out += char;
    size += bytes;
  }
  return { text: `${out.trimEnd()}…`, clipped: true };
}

interface FitTarget {
  type: "power" | "heartRate" | "speed" | "cadence";
  /** Zone de l'appareil (1–n), ou 0 pour une plage personnalisée. */
  value: number;
  low?: number;
  high?: number;
}

interface Converter {
  sport: SegmentSport;
  ctx: ExportContext;
  issues: CompatibilityIssue[];
  once: Set<string>;
  steps: WorkoutStepMesg[];
}

function noteOnce(c: Converter, key: string, issue: CompatibilityIssue) {
  if (c.once.has(key)) return;
  c.once.add(key);
  c.issues.push(issue);
}

const where = (step: Step, index: number) => `Étape ${index + 1}, ${step.label || STEP_TYPE_LABELS[step.type]}`;
const int = (value: number) => Math.max(0, Math.round(value));
/** Vitesse en m/s → valeur brute FIT (mm/s). */
const speedRaw = (metersPerSecond: number) => int(metersPerSecond * 1000);

function thresholdSpeed(sport: SegmentSport, ctx: ExportContext): number | null {
  const secPerMeter = thresholdSecondsPerMeter(sport, ctx.thresholds);
  return secPerMeter ? 1 / secPerMeter : null;
}

function thresholdLabel(sport: SegmentSport, ctx: ExportContext): string {
  if (sport === "swim" && ctx.thresholds?.swim?.cssSPer100m) return `CSS ${formatClock(ctx.thresholds.swim.cssSPer100m)} /100 m`;
  if (ctx.thresholds?.run?.thresholdPaceSPerKm) return `allure seuil ${formatClock(ctx.thresholds.run.thresholdPaceSPerKm)} /km`;
  return "allure seuil";
}

/** Convertit une cible au format FIT ; null (avec l'écart expliqué) si les appareils ne la prennent pas. */
function mapTarget(c: Converter, target: Target, at: string): FitTarget | null {
  const { min, max } = target;
  const key = `${target.metric}.${target.unit}`;
  const label = describeTarget(target, c.sport);
  switch (key) {
    case "power.percent_ftp":
      noteOnce(c, "ftp", {
        severity: "info",
        message: "Puissance en % FTP : l'appareil la calcule avec la FTP réglée dans son propre profil.",
      });
      return { type: "power", value: 0, low: int(min), high: int(max) };
    case "power.watts":
      return { type: "power", value: 0, low: int(min) + 1000, high: int(max) + 1000 };
    case "power.zone": {
      const span = zoneSpan(POWER_ZONES, min, max);
      if (!span) return null;
      noteOnce(c, "power-zone", {
        severity: "info",
        message: "Zones de puissance converties en plages de % FTP (modèle de Coggan), pour ne pas dépendre des zones réglées sur l'appareil.",
      });
      return { type: "power", value: 0, low: span.min, high: span.max };
    }
    case "heart_rate.bpm":
      return { type: "heartRate", value: 0, low: int(min) + 100, high: int(max) + 100 };
    case "heart_rate.percent_max_hr":
      return { type: "heartRate", value: 0, low: int(min), high: Math.min(100, int(max)) };
    case "heart_rate.percent_lthr": {
      const lthr = lthrFor(c.sport, c.ctx.thresholds);
      if (!lthr) {
        c.issues.push({ severity: "loss", where: at, message: `${label} : sans FC seuil enregistrée, cible non convertible (indiquée dans les notes).` });
        return null;
      }
      noteOnce(c, "lthr", { severity: "info", message: `FC en % du seuil convertie en battements par minute (FC seuil : ${lthr} bpm).` });
      return { type: "heartRate", value: 0, low: int((min * lthr) / 100) + 100, high: int((max * lthr) / 100) + 100 };
    }
    case "heart_rate.zone": {
      const lthr = lthrFor(c.sport, c.ctx.thresholds);
      const zones = hrZonesFor(c.sport);
      const span = zones ? zoneSpan(zones, min, max) : null;
      if (lthr && span) {
        noteOnce(c, "hr-zone", {
          severity: "info",
          message: `Zones de FC converties en battements par minute (FC seuil : ${lthr} bpm), pour ne pas dépendre des zones réglées sur l'appareil.`,
        });
        return { type: "heartRate", value: 0, low: int((span.min * lthr) / 100) + 100, high: int((span.max * lthr) / 100) + 100 };
      }
      if (min === max) {
        noteOnce(c, "device-hr-zone", {
          severity: "info",
          message: "Zone de FC transmise telle quelle : l'appareil applique les zones réglées dans son profil (FC seuil non enregistrée dans TriCoach).",
        });
        return { type: "heartRate", value: min };
      }
      c.issues.push({ severity: "loss", where: at, message: `${label} : plage de zones sans FC seuil enregistrée, cible non convertible (indiquée dans les notes).` });
      return null;
    }
    case "pace.sec_per_km":
    case "pace.sec_per_100m": {
      const meters = key === "pace.sec_per_km" ? 1000 : 100;
      // Allure : min = la plus rapide. Vitesse : low = la plus lente.
      return { type: "speed", value: 0, low: speedRaw(meters / max), high: speedRaw(meters / min) };
    }
    case "pace.percent_threshold":
    case "pace.zone": {
      const speed = thresholdSpeed(c.sport, c.ctx);
      const zones = paceZonesFor(c.sport);
      const span = key === "pace.zone" ? (zones ? zoneSpan(zones, min, max) : null) : { min, max };
      if (!speed || !span) {
        c.issues.push({
          severity: "loss",
          where: at,
          message: `${label} : sans ${c.sport === "swim" ? "CSS" : "allure seuil"} enregistrée, cible non convertible (indiquée dans les notes).`,
        });
        return null;
      }
      noteOnce(c, "pace", { severity: "info", message: `Allures relatives converties en allures réelles (${thresholdLabel(c.sport, c.ctx)}).` });
      return { type: "speed", value: 0, low: speedRaw((span.min / 100) * speed), high: speedRaw((span.max / 100) * speed) };
    }
    case "speed.kmh":
      return { type: "speed", value: 0, low: speedRaw(min / 3.6), high: speedRaw(max / 3.6) };
    case "cadence.rpm":
      return { type: "cadence", value: 0, low: int(min), high: int(max) };
    case "cadence.spm":
      c.issues.push({ severity: "loss", where: at, message: `${label} : cadence de course non transmise (unité variable selon les appareils), indiquée dans les notes.` });
      return null;
    case "rpe.scale":
      c.issues.push({ severity: "loss", where: at, message: `${label} : les appareils Garmin n'ont pas de cible RPE, indiquée dans les notes.` });
      return null;
    default:
      c.issues.push({ severity: "loss", where: at, message: `${label} : cible non prise en charge, indiquée dans les notes.` });
      return null;
  }
}

function clipped(c: Converter, text: string, maxBytes: number, at: string, what: string): string {
  const result = clipUtf8(text, maxBytes);
  if (result.clipped) c.issues.push({ severity: "loss", where: at, message: `${what} raccourci${what.endsWith("s") ? "es" : ""} à ${maxBytes} octets (limite du format FIT).` });
  return result.text;
}

function pushStep(c: Converter, step: Step, index: number) {
  const at = where(step, index);
  const mesg: WorkoutStepMesg = {
    messageIndex: c.steps.length,
    wktStepName: clipped(c, step.label || STEP_TYPE_LABELS[step.type], MAX_STEP_NAME_BYTES, at, "Intitulé"),
    intensity: INTENSITY[step.type] as WorkoutStepMesg["intensity"],
  };
  const length = step.length;
  if (length.unit === "time") {
    mesg.durationType = "time";
    mesg.durationValue = length.seconds * 1000;
  } else if (length.unit === "distance") {
    mesg.durationType = "distance";
    mesg.durationValue = int(length.meters * 100);
  } else if (length.unit === "reps") {
    mesg.durationType = "reps";
    mesg.durationValue = length.reps;
  } else {
    mesg.durationType = "open";
  }

  const extra: string[] = [];
  const mapped: FitTarget[] = [];
  for (const target of step.targets) {
    const fit = mapTarget(c, target, at);
    if (fit) mapped.push(fit);
    else extra.push(describeTarget(target, c.sport));
  }
  const [primary, secondary] = mapped;
  if (primary) {
    mesg.targetType = primary.type;
    mesg.targetValue = primary.value;
    if (primary.value === 0) {
      mesg.customTargetValueLow = primary.low;
      mesg.customTargetValueHigh = primary.high;
    }
  } else {
    mesg.targetType = "open";
  }
  if (secondary) {
    mesg.secondaryTargetType = secondary.type;
    mesg.secondaryTargetValue = secondary.value;
    if (secondary.value === 0) {
      mesg.secondaryCustomTargetValueLow = secondary.low;
      mesg.secondaryCustomTargetValueHigh = secondary.high;
    }
    noteOnce(c, "secondary", { severity: "info", message: "Deuxième cible transmise comme cible secondaire : tous les appareils ne l'affichent pas." });
  }

  const equipment = step.equipment ?? [];
  const deviceEquipment = c.sport === "swim" ? equipment.filter((e) => EQUIPMENT[e]) : [];
  if (deviceEquipment[0]) mesg.equipment = EQUIPMENT[deviceEquipment[0]] as WorkoutStepMesg["equipment"];
  const unlisted = equipment.filter((e) => e !== deviceEquipment[0]);
  if (unlisted.length) {
    c.issues.push({
      severity: "loss",
      where: at,
      message: `Matériel ${unlisted.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ")} : le format FIT n'en retient qu'un pour la natation, indiqué dans les notes.`,
    });
    extra.push(`Matériel : ${unlisted.map((e) => EQUIPMENT_LABELS[e]).join(", ")}`);
  }
  if (step.sendOffSeconds) {
    c.issues.push({ severity: "loss", where: at, message: `Départ toutes les ${formatClock(step.sendOffSeconds)} : non pris en charge comme tel, indiqué dans les notes.` });
    extra.push(`Départ toutes les ${formatClock(step.sendOffSeconds)}`);
  }
  if (length.unit === "reps") {
    noteOnce(c, "reps", { severity: "info", message: "Étapes en répétitions : appuyez sur le bouton tour à la fin de chaque série." });
  }
  const notes = [step.notes, ...extra].filter((n): n is string => Boolean(n && n.trim())).join(" — ");
  if (notes) mesg.notes = clipped(c, notes.replace(/\s+/g, " "), MAX_NOTES_BYTES, at, "Notes");
  c.steps.push(mesg);
}

function walk(c: Converter, nodes: WorkoutNode[], inRepeat: boolean, counter: { index: number }) {
  for (const node of nodes) {
    if (node.kind === "step") {
      pushStep(c, node, counter.index);
      counter.index += 1;
      continue;
    }
    if (inRepeat || node.count === 1) {
      if (inRepeat) {
        noteOnce(c, "nested", {
          severity: "info",
          message: "Répétitions imbriquées déroulées dans la répétition qui les contient (prise en charge inégale selon les appareils).",
        });
      }
      const start = counter.index;
      for (let i = 0; i < node.count; i += 1) {
        counter.index = start;
        walk(c, node.steps, inRepeat, counter);
      }
      continue;
    }
    const firstStep = c.steps.length;
    walk(c, node.steps, true, counter);
    c.steps.push({
      messageIndex: c.steps.length,
      durationType: "repeatUntilStepsCmplt",
      durationValue: firstStep,
      targetType: "open",
      targetValue: node.count,
    });
  }
}

export interface FitWorkoutResult {
  bytes: Uint8Array | null;
  issues: CompatibilityIssue[];
  steps: number;
}

function randomSerial(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] || 1;
}

/** Convertit un segment en fichier FIT de séance, avec la liste précise des écarts. */
export function buildFitWorkout(segment: Segment, ctx: ExportContext): FitWorkoutResult {
  const c: Converter = { sport: segment.sport, ctx, issues: [], once: new Set(), steps: [] };
  walk(c, segment.steps, false, { index: 0 });
  if (!c.steps.length) return { bytes: null, steps: 0, issues: [{ severity: "blocking", message: "Séance vide." }] };
  if (c.steps.length > FIT_STEP_WARNING) {
    c.issues.push({
      severity: "info",
      message: `${c.steps.length} étapes : certains appareils limitent la longueur des séances ; si la vôtre est refusée, simplifiez les répétitions.`,
    });
  }
  if (segment.sport === "swim") {
    c.issues.push({ severity: "info", message: "Natation en piscine : la longueur du bassin se règle sur la montre au début de la séance." });
  }

  const sport = SPORTS[segment.sport];
  const head = "Séance";
  const name = clipped(c, ctx.title || segment.title || "Séance", MAX_NAME_BYTES, head, "Nom de séance");
  const description = [segment.goal, ctx.description].filter(Boolean).join(" — ").replace(/\s+/g, " ");
  const fileId: FileIdMesg = {
    type: "workout",
    manufacturer: "development",
    product: 0,
    serialNumber: ctx.serialNumber ?? randomSerial(),
    timeCreated: ctx.now ?? new Date(),
  };
  const workout: WorkoutMesg = {
    wktName: name,
    sport: sport.sport as WorkoutMesg["sport"],
    subSport: sport.subSport as WorkoutMesg["subSport"],
    numValidSteps: c.steps.length,
  };
  if (description) workout.wktDescription = clipped(c, description, MAX_NOTES_BYTES, head, "Description");

  const fit = new Encoder();
  fit.onMesg(Profile.MesgNum.FILE_ID, fileId);
  fit.onMesg(Profile.MesgNum.WORKOUT, workout);
  for (const step of c.steps) fit.onMesg(Profile.MesgNum.WORKOUT_STEP, step);
  return { bytes: fit.close(), steps: c.steps.length, issues: c.issues };
}

export interface FitWorkoutSummary {
  name: string;
  sport: string;
  steps: number;
  /** Durée totale des étapes en temps, répétitions comprises (secondes). */
  timeSeconds: number;
  /** Distance totale des étapes en distance, répétitions comprises (mètres). */
  distanceMeters: number;
}

type DecodedStep = Record<string, unknown>;

/** Durée et distance d'une plage d'étapes (index de début inclus, fin exclue), répétitions comprises. */
function sumSteps(steps: DecodedStep[], from: number, to: number): { time: number; distance: number } {
  let time = 0;
  let distance = 0;
  for (let i = from; i < to; i += 1) {
    const step = steps[i];
    if (step.durationType === "repeatUntilStepsCmplt") {
      const start = Number(step.durationStep);
      const count = Number(step.repeatSteps);
      // Le premier passage est déjà compté ; la répétition ajoute (count − 1) passages.
      const inner = sumSteps(steps, start, i);
      time += inner.time * (count - 1);
      distance += inner.distance * (count - 1);
      continue;
    }
    if (step.durationType === "time") time += Number(step.durationTime);
    if (step.durationType === "distance") distance += Number(step.durationDistance);
  }
  return { time, distance };
}

/** Relit un fichier FIT de séance avec le SDK officiel et contrôle sa cohérence. */
export function validateFitWorkout(bytes: Uint8Array): ValidationResult & { summary?: FitWorkoutSummary } {
  const errors: string[] = [];
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) return { ok: false, errors: ["Ce n'est pas un fichier FIT"] };
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) return { ok: false, errors: ["Contrôle d'intégrité (CRC) en échec"] };
  const { messages, errors: readErrors } = decoder.read({ expandSubFields: true, convertTypesToStrings: true });
  if (readErrors.length) return { ok: false, errors: readErrors.map((e) => (e instanceof Error ? e.message : String(e))) };

  const fileId = messages.fileIdMesgs?.[0] as DecodedStep | undefined;
  if (fileId?.type !== "workout") errors.push(`Type de fichier inattendu : ${String(fileId?.type ?? "absent")}`);
  const workouts = (messages.workoutMesgs ?? []) as DecodedStep[];
  if (workouts.length !== 1) errors.push("Un message workout attendu");
  const workout = workouts[0] ?? {};
  const steps = (messages.workoutStepMesgs ?? []) as DecodedStep[];
  if (!steps.length) errors.push("Aucune étape");
  if (Number(workout.numValidSteps) !== steps.length) errors.push(`numValidSteps (${String(workout.numValidSteps)}) différent du nombre d'étapes (${steps.length})`);
  if (!workout.wktName) errors.push("Nom de séance manquant");
  if (typeof workout.sport !== "string") errors.push("Sport manquant");

  steps.forEach((step, i) => {
    const label = `Étape ${i + 1}`;
    if (step.messageIndex !== i) errors.push(`${label} : index ${String(step.messageIndex)} au lieu de ${i}`);
    switch (step.durationType) {
      case "time":
        if (!(Number(step.durationTime) > 0)) errors.push(`${label} : durée invalide`);
        break;
      case "distance":
        if (!(Number(step.durationDistance) > 0)) errors.push(`${label} : distance invalide`);
        break;
      case "reps":
        if (!(Number(step.durationReps) > 0)) errors.push(`${label} : répétitions invalides`);
        break;
      case "open":
        break;
      case "repeatUntilStepsCmplt": {
        const start = Number(step.durationStep);
        if (!(Number.isInteger(start) && start >= 0 && start < i)) errors.push(`${label} : répétition vers une étape invalide (${String(step.durationStep)})`);
        if (!(Number(step.repeatSteps) >= 2)) errors.push(`${label} : nombre de répétitions invalide`);
        break;
      }
      default:
        errors.push(`${label} : type de durée inattendu (${String(step.durationType)})`);
    }
    if (step.durationType === "repeatUntilStepsCmplt") return;
    for (const prefix of ["", "secondary"] as const) {
      const type = step[prefix ? "secondaryTargetType" : "targetType"];
      const value = step[prefix ? "secondaryTargetValue" : "targetValue"];
      if (type === undefined || type === "open") continue;
      if (!["power", "heartRate", "speed", "cadence"].includes(String(type))) errors.push(`${label} : cible inattendue (${String(type)})`);
      if (Number(value) === 0) {
        const low = Number(step[prefix ? "secondaryCustomTargetValueLow" : "customTargetValueLow"]);
        const high = Number(step[prefix ? "secondaryCustomTargetValueHigh" : "customTargetValueHigh"]);
        if (!(Number.isFinite(low) && Number.isFinite(high) && low <= high && high > 0)) errors.push(`${label} : plage de cible invalide`);
      }
    }
  });

  const totals = errors.length ? { time: 0, distance: 0 } : sumSteps(steps, 0, steps.length);
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      name: String(workout.wktName ?? ""),
      sport: String(workout.sport ?? ""),
      steps: steps.length,
      timeSeconds: Math.round(totals.time),
      distanceMeters: Math.round(totals.distance),
    },
  };
}
