/**
 * Séance TriCoach → séance prévue d'intervals.icu, écrite dans le format texte de son éditeur
 * (forum intervals.icu, « Workout Builder Syntax Quick Guide »), qu'intervals.icu transmet ensuite
 * aux montres reliées chez lui (Suunto, Garmin, COROS).
 *
 * Format retenu, tel que documenté :
 * - une étape par ligne « - <texte> <durée ou distance> <cible> [cadence] » ; le texte placé avant la
 *   durée devient le message de l'étape ;
 * - durées « 1h2m30s », distances « 400mtr », « 2km » ; répétitions : ligne « 4x » entre deux lignes
 *   vides, sans répétition imbriquée ;
 * - cibles : watts « 200-240w » ou « % » de FTP, zones « Z2 » ; FC « % LTHR », « % HR » (de la FC max)
 *   ou zones « Z2 HR » ; allure « 4:30/km-4:40/km Pace » ou « % Pace » ; cadence « 85-95rpm ».
 * Les cibles sont écrites en valeurs absolues quand les seuils de TriCoach le permettent, pour que la
 * montre reçoive exactement les valeurs de TriCoach. Ce que le format ne porte pas (durée libre,
 * répétitions de renforcement, vitesse, cadence de course, RPE) est dit : rien n'est perdu en silence.
 *
 * intervals.icu ne trace qu'un type de cible par séance. Une course (ou une sortie vélo) qui mêle FC et
 * allure (ou puissance) est donc transmise tout en allure (ou en puissance) : chaque étape en FC est
 * convertie par équivalence des zones théoriques (lib/workout/equivalence.ts) et sa FC visée reste
 * écrite dans les consignes. Dans ces séances, les étapes d'au moins 2 minutes en allure ou en
 * puissance y reçoivent aussi la FC correspondante, à titre indicatif.
 */
import type { CompatibilityIssue } from "@/lib/export/types";
import { watchText } from "@/lib/watch/text";
import { resolveTarget, stepQuantities, type MissingThreshold } from "@/lib/workout/compute";
import { effortMetricFor, heartRateEquivalent, heartRateRange, hrPercentOfThreshold, hrTargetAsEffort, type EffortMetric, type HeartRateEquivalent } from "@/lib/workout/equivalence";
import { describeTarget, formatClock } from "@/lib/workout/format";
import { EQUIPMENT_LABELS, SPORT_LABELS, STEP_TYPE_LABELS, type SegmentSport, type Step, type Target, type Workout, type WorkoutNode } from "@/lib/workout/schema";
import { lthrFor, type AthleteThresholds } from "@/lib/workout/zones";
import type { IntervalsEvent } from "./api";

/** Version de la conversion : la changer redépose toutes les séances (nouvelle empreinte). */
export const INTERVALS_FORMAT_VERSION = 2;

/** Durée en dessous de laquelle la FC n'a pas le temps de suivre l'effort : pas de FC indicative. */
const HR_HINT_MIN_SECONDS = 120;

/** Fenêtre de dépôt : aujourd'hui et les 13 jours suivants (intervals.icu envoie la semaine à venir aux montres). */
export const INTERVALS_WINDOW_DAYS = 14;

const TYPES: Record<SegmentSport, IntervalsEvent["type"]> = {
  bike: "Ride",
  run: "Run",
  swim: "Swim",
  strength: "WeightTraining",
  other: "Workout",
};

export interface IntervalsContext {
  sessionId: string;
  title: string;
  description: string | null;
  nutrition: string | null;
  /** Date locale de la séance (AAAA-MM-JJ). */
  date: string;
  thresholds?: AthleteThresholds;
}

export interface IntervalsBuild {
  segmentIndex: number;
  sport: SegmentSport;
  externalId: string;
  issues: CompatibilityIssue[];
  /** null : la partie ne peut pas être déposée (écart bloquant, expliqué dans `issues`). */
  event: IntervalsEvent | null;
}

export const intervalsExternalId = (sessionId: string, segmentIndex: number) => `tricoach-${sessionId}-${segmentIndex}`;

const int = (n: number) => String(Math.round(n));
/** « 200-240w », « 90-100rpm » ; l'allure répète son unité : « 4:30/km-4:40/km ». */
const span = (min: number, max: number, format: (n: number) => string, unit = "", eachBound = false) =>
  min === max ? `${format(min)}${unit}` : `${format(min)}${eachBound ? unit : ""}-${format(max)}${unit}`;

/** 900 → « 15m », 90 → « 1m30s », 3725 → « 1h2m5s ». */
export function intervalsDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h ? `${h}h` : ""}${m ? `${m}m` : ""}${rest || (!h && !m) ? `${rest}s` : ""}`;
}

/** Distance : mètres « 400mtr » (toujours en natation), kilomètres ronds « 2km » ou « 1.5km » ailleurs. */
export function intervalsDistance(meters: number, sport: SegmentSport): string {
  const m = Math.round(meters);
  if (sport !== "swim" && m >= 1000 && m % 100 === 0) return `${m / 1000}km`;
  return `${m}mtr`;
}

const MISSING: Record<Exclude<MissingThreshold, "unsupported">, string> = {
  bike_ftp: "FTP vélo",
  bike_lthr: "FC seuil vélo",
  run_lthr: "FC seuil course",
  max_hr: "FC maximale",
  run_threshold_pace: "allure seuil course",
  swim_css: "CSS natation",
};

interface Converter {
  sport: SegmentSport;
  thresholds?: AthleteThresholds;
  issues: CompatibilityIssue[];
  once: Set<string>;
  index: number;
  /** Consignes de chaque étape, reprises dans la description (intervals.icu ne les porte pas sur la montre). */
  notes: string[];
  blocking: string | null;
  /** Types de cibles transmis (puissance, FC, allure) : intervals.icu n'en trace qu'un dans son graphique. */
  metrics: Set<string>;
  /** Partie qui mêle FC et allure (course) ou FC et puissance (vélo) : la FC est convertie vers cette mesure. */
  effort: EffortMetric | null;
  /** Étapes dont la FC a été convertie. */
  converted: number;
}

const METRIC_WORDS: Record<string, string> = { power: "puissance", heart_rate: "fréquence cardiaque", pace: "allure" };

const zoneText = (zones: { min: number; max: number }) => (zones.min === zones.max ? `Z${zones.min}` : `Z${zones.min}–Z${zones.max}`);
const rangeText = (min: number, max: number) => (Math.round(min) === Math.round(max) ? `≈ ${Math.round(min)}` : `${Math.round(min)}–${Math.round(max)}`);
const percentText = (p: { min: number; max: number }) => `${rangeText(p.min, p.max)} % FC seuil`;
const hrValues = (hr: HeartRateEquivalent) => (hr.bpm ? `${rangeText(hr.bpm.min, hr.bpm.max)} bpm` : percentText(hr.percent));

/** FC visée par le coach, écrite en consigne : « FC visée Z1 (90–151 bpm) ». */
function targetHrText(c: Converter, target: Target): string {
  const pct = hrPercentOfThreshold(target, c.sport, c.thresholds);
  const range = pct ? heartRateRange(pct, c.sport, c.thresholds) : null;
  const resolved = resolveTarget(target, c.sport, c.thresholds);
  const bpm = resolved.ok && resolved.target.metric === "heart_rate" ? `${resolved.target.min}–${resolved.target.max} bpm` : null;
  if (!range) return `FC visée ${describeTarget(target, c.sport)}`;
  const zones = target.unit === "zone" ? { min: target.min, max: target.max } : range.zones;
  return `FC visée ${zoneText(zones)} (${bpm ?? (target.unit === "zone" ? percentText(range.percent) : describeTarget(target, c.sport))})`;
}

/** Une partie mêle-t-elle la FC et la mesure d'effort de sa discipline ? Celle-ci est alors la seule transmise. */
function mixedEffort(sport: SegmentSport, nodes: WorkoutNode[]): EffortMetric | null {
  const effort = effortMetricFor(sport);
  if (!effort) return null;
  const metrics = new Set<string>();
  const visit = (list: WorkoutNode[]) => list.forEach((node) => (node.kind === "step" ? node.targets.forEach((t) => metrics.add(t.metric)) : visit(node.steps)));
  visit(nodes);
  return metrics.has(effort) && metrics.has("heart_rate") ? effort : null;
}

function noteOnce(c: Converter, key: string, issue: CompatibilityIssue) {
  if (c.once.has(key)) return;
  c.once.add(key);
  c.issues.push(issue);
}

/** Cible principale au format d'intervals.icu, en valeurs absolues quand c'est possible. */
function primaryTarget(c: Converter, target: Target, at: string): string | null {
  const wording = describeTarget(target, c.sport);
  const { min, max } = target;
  const resolved = resolveTarget(target, c.sport, c.thresholds);
  const relativeFallback = (text: string, threshold: string) => {
    noteOnce(c, `relative:${threshold}`, {
      severity: "info",
      message: `Cibles en % de la ${threshold} : sans valeur dans TriCoach, intervals.icu les calcule avec la ${threshold} réglée chez lui.`,
    });
    return text;
  };

  switch (target.metric) {
    case "power":
      if (resolved.ok && resolved.target.metric === "power") return span(resolved.target.min, resolved.target.max, int, "w");
      if (target.unit === "percent_ftp") return relativeFallback(`${span(min, max, int)}%`, "FTP");
      if (target.unit === "zone") return relativeFallback(min === max ? `Z${min}` : `Z${min}-Z${max}`, "FTP");
      break;
    case "heart_rate": {
      // intervals.icu exprime la FC en % du seuil, en % de la FC max ou en zones (pas en bpm).
      if (target.unit === "percent_lthr") {
        noteOnce(c, "lthr", { severity: "info", message: "FC en % du seuil : intervals.icu applique la FC seuil réglée chez lui ; gardez la même que dans TriCoach." });
        return `${span(min, max, int)}% LTHR`;
      }
      if (target.unit === "percent_max_hr") {
        noteOnce(c, "maxhr", { severity: "info", message: "FC en % de la FC max : intervals.icu applique la FC max réglée chez lui ; gardez la même que dans TriCoach." });
        return `${span(min, max, int)}% HR`;
      }
      if (target.unit === "zone") {
        noteOnce(c, "hrzone", { severity: "info", message: "Zones de FC : calculées par intervals.icu avec ses propres zones." });
        return min === max ? `Z${min} HR` : `Z${min}-Z${max} HR`;
      }
      // bpm : converti en % du seuil (ou de la FC max) de TriCoach.
      const lthr = lthrFor(c.sport, c.thresholds);
      if (lthr) {
        noteOnce(c, "bpm-lthr", {
          severity: "info",
          message: `FC en bpm convertie en % de votre FC seuil (${lthr} bpm), seule forme lue par intervals.icu ; gardez la même FC seuil chez lui.`,
        });
        return `${span((min / lthr) * 100, (max / lthr) * 100, int)}% LTHR`;
      }
      const maxHr = c.thresholds?.general?.maxHrBpm;
      if (maxHr) {
        noteOnce(c, "bpm-max", {
          severity: "info",
          message: `FC en bpm convertie en % de votre FC max (${maxHr} bpm), seule forme lue par intervals.icu ; gardez la même FC max chez lui.`,
        });
        return `${span((min / maxHr) * 100, (max / maxHr) * 100, int)}% HR`;
      }
      c.issues.push({ severity: "loss", where: at, message: `${wording} : sans FC seuil ni FC max dans TriCoach, cible non transmise (reprise dans la description).` });
      return null;
    }
    case "pace":
      if (resolved.ok && resolved.target.metric === "pace") {
        const unit = resolved.target.unit === "sec_per_km" ? "/km" : "/100m";
        return `${span(resolved.target.min, resolved.target.max, formatClock, unit, true)} Pace`;
      }
      if (target.unit === "percent_threshold") return relativeFallback(`${span(min, max, int)}% Pace`, c.sport === "swim" ? "CSS" : "allure seuil");
      if (target.unit === "zone") return relativeFallback(min === max ? `Z${min} Pace` : `Z${min}-Z${max} Pace`, c.sport === "swim" ? "CSS" : "allure seuil");
      break;
    case "speed":
      c.issues.push({ severity: "loss", where: at, message: `${wording} : cible de vitesse absente du format d'intervals.icu, reprise dans la description.` });
      return null;
    default:
      break;
  }
  if (!resolved.ok && resolved.missing !== "unsupported") {
    c.issues.push({ severity: "loss", where: at, message: `${wording} : sans ${MISSING[resolved.missing]} dans TriCoach, cible non transmise (reprise dans la description).` });
  } else {
    c.issues.push({ severity: "loss", where: at, message: `${wording} : cible non prise en charge, reprise dans la description.` });
  }
  return null;
}

/**
 * Message de l'étape : l'intitulé, sans chiffres (intervals.icu lirait « 30s » ou « 4x » comme une
 * durée ou une répétition) ni signes de son format.
 */
function cueText(c: Converter, step: Step): string {
  const label = step.label?.trim() || STEP_TYPE_LABELS[step.type];
  if (/\d/.test(label)) {
    noteOnce(c, "digits", {
      severity: "info",
      message: "Intitulés avec des chiffres : remplacés sur la montre par le type d'étape (intervals.icu les lirait comme des durées), repris dans la description.",
    });
    return STEP_TYPE_LABELS[step.type];
  }
  return watchText(label).replace(/[<>^#*_`|\\[\]-]/g, " ").replace(/\s+/g, " ").trim() || STEP_TYPE_LABELS[step.type];
}

function stepLine(c: Converter, step: Step): string | null {
  c.index += 1;
  const label = step.label?.trim() || STEP_TYPE_LABELS[step.type];
  const at = `Étape ${c.index}, ${label}`;
  const extra: string[] = [];
  if (/\d/.test(label)) extra.push(label);

  let length: string;
  switch (step.length.unit) {
    case "time":
      length = intervalsDuration(step.length.seconds);
      break;
    case "distance":
      length = intervalsDistance(step.length.meters, c.sport);
      break;
    default:
      // Le format d'intervals.icu n'a ni durée libre (bouton tour) ni répétitions de renforcement.
      c.blocking ??=
        step.length.unit === "reps"
          ? `${at} : étape en répétitions, que le format d'intervals.icu ne sait pas transmettre ; donnez-lui une durée.`
          : `${at} : étape à durée libre (bouton tour), que le format d'intervals.icu ne sait pas transmettre ; donnez-lui une durée ou une distance.`;
      return null;
  }

  const parts: string[] = [];
  let cadence: string | null = null;
  // Partie convertie : la cible d'allure ou de puissance de l'étape passe avant sa cible de FC.
  const targets = c.effort ? [...step.targets].sort((a, b) => Number(b.metric === c.effort) - Number(a.metric === c.effort)) : step.targets;
  const longEnough = (stepQuantities(step, c.sport, c.thresholds).duration.value ?? 0) >= HR_HINT_MIN_SECONDS;
  for (const target of targets) {
    const wording = describeTarget(target, c.sport);
    if (target.metric === "rpe") {
      extra.push(`effort ressenti ${wording}`);
      noteOnce(c, "rpe", { severity: "loss", message: "Effort ressenti (RPE) : absent du format d'intervals.icu, repris dans la description de la séance." });
      continue;
    }
    if (target.metric === "cadence") {
      if (target.unit === "rpm" && !cadence) {
        cadence = span(target.min, target.max, int, "rpm");
        continue;
      }
      extra.push(wording);
      c.issues.push({ severity: "loss", where: at, message: `${wording} : cadence de course absente du format d'intervals.icu, reprise dans la description.` });
      continue;
    }
    if (parts.length) {
      extra.push(c.effort && target.metric === "heart_rate" ? targetHrText(c, target) : wording);
      c.issues.push({ severity: "loss", where: at, message: `${wording} : une seule cible par étape chez intervals.icu, la seconde est reprise dans la description.` });
      continue;
    }
    if (c.effort && target.metric === "heart_rate") {
      // FC d'une partie qui mêle les mesures : transmise en allure (ou en puissance), la FC visée en consigne.
      const converted = hrTargetAsEffort(target, c.sport, c.thresholds);
      const text = converted ? primaryTarget(c, converted, at) : null;
      if (text) {
        parts.push(text);
        c.metrics.add(c.effort);
        c.converted += 1;
        extra.push(targetHrText(c, target));
        continue;
      }
    }
    const text = primaryTarget(c, target, at);
    if (text) {
      parts.push(text);
      if (METRIC_WORDS[target.metric]) c.metrics.add(target.metric);
      // Partie convertie, allure ou puissance assez longue : la FC qui y correspond d'après les zones théoriques.
      const hr = c.effort && target.metric === c.effort && longEnough ? heartRateEquivalent(target, c.sport, c.thresholds) : null;
      if (hr) extra.push(`FC indicative ${zoneText(hr.zones)} (${hrValues(hr)})`);
    } else extra.push(wording);
  }
  if (cadence) parts.push(cadence);

  if (step.sendOffSeconds) {
    extra.push(`départ toutes les ${formatClock(step.sendOffSeconds)}`);
    c.issues.push({ severity: "loss", where: at, message: `Départ toutes les ${formatClock(step.sendOffSeconds)} : absent du format d'intervals.icu, repris dans la description.` });
  }
  if (step.equipment?.length) extra.push(`matériel : ${step.equipment.map((e) => EQUIPMENT_LABELS[e].toLowerCase()).join(", ")}`);
  if (step.notes?.trim()) extra.push(step.notes.replace(/\s+/g, " ").trim());
  if (extra.length) c.notes.push(`${at} : ${extra.join(", ")}`);

  return ["-", cueText(c, step), length, ...parts].join(" ");
}

function flatten(c: Converter, nodes: WorkoutNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind === "step") {
      const line = stepLine(c, node);
      return line ? [line] : [];
    }
    noteOnce(c, "nested", {
      severity: "info",
      message: "Répétition dans une répétition : déroulée dans la répétition qui la contient (intervals.icu n'a qu'un niveau de répétition).",
    });
    const body = flatten(c, node.steps);
    return Array.from({ length: node.count }, () => body).flat();
  });
}

/** Lignes d'une partie : étapes, et répétitions entourées de lignes vides. */
function lines(c: Converter, nodes: WorkoutNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "step") {
      const line = stepLine(c, node);
      if (line) out.push(line);
      continue;
    }
    const body = flatten(c, node.steps);
    if (node.count === 1) {
      out.push(...body);
      continue;
    }
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(`${node.count}x`, ...body, "");
  }
  while (out[out.length - 1] === "") out.pop();
  return out;
}

/** Texte libre sans ligne lue comme une étape (« - ») ou une répétition (« 4x » en fin de ligne). */
function freeText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*]\s*/, "").replace(/(\d+)\s*x\s*$/i, "$1 fois"))
    .filter(Boolean)
    .join("\n");
}

/** Une séance prévue d'intervals.icu par discipline de la séance TriCoach. */
export function buildIntervalsEvents(workout: Workout, ctx: IntervalsContext): IntervalsBuild[] {
  const multi = workout.segments.length > 1;
  return workout.segments.map((segment, segmentIndex) => {
    const c: Converter = {
      sport: segment.sport,
      thresholds: ctx.thresholds,
      issues: [],
      once: new Set(),
      index: 0,
      notes: [],
      blocking: null,
      metrics: new Set(),
      effort: mixedEffort(segment.sport, segment.steps),
      converted: 0,
    };
    const externalId = intervalsExternalId(ctx.sessionId, segmentIndex);
    const steps = lines(c, segment.steps);
    if (c.blocking || !steps.length) {
      return {
        segmentIndex,
        sport: segment.sport,
        externalId,
        issues: [...c.issues, { severity: "blocking", message: c.blocking ?? "Séance sans étape à transmettre." }],
        event: null,
      };
    }
    if (multi) {
      noteOnce(c, "brick", { severity: "info", message: "Enchaînement : une séance par discipline, le même jour, à lancer l'une après l'autre sur la montre." });
    }
    if (c.converted) {
      const words = c.effort === "pace" ? "en allure" : "en puissance";
      noteOnce(c, "converted", {
        severity: "info",
        message: `Fréquence cardiaque transmise ${words}, par équivalence des zones théoriques (zone 2 de FC → zone 2 ${c.effort === "pace" ? "d'allure" : "de puissance"}) : la montre et le graphique d'intervals.icu suivent un seul type de cible. La FC visée reste écrite dans les consignes de chaque étape.`,
      });
    }
    if (c.metrics.size > 1) {
      const kinds = [...c.metrics].map((m) => METRIC_WORDS[m]).join(" et ");
      noteOnce(c, "mixed", {
        severity: "info",
        message: `Cibles de types différents (${kinds}) : la montre suit chaque étape avec sa cible, mais le graphique d'intervals.icu n'en dessine qu'un type, les autres étapes y paraissent grises. Pour un graphique complet, gardez un seul type de cible dans la séance.`,
      });
    }
    const sportLabel = SPORT_LABELS[segment.sport].toLowerCase();
    const name = watchText(multi ? `${ctx.title} (${segmentIndex + 1}/${workout.segments.length} ${sportLabel})` : ctx.title).slice(0, 120);
    // Un premier paragraphe est nécessaire : sans lui, l'envoi vers les montres Suunto échoue.
    const intro = [ctx.description?.trim(), ctx.nutrition?.trim() ? `Nutrition : ${ctx.nutrition.trim()}` : null].filter(Boolean).join("\n\n") || `${ctx.title}.`;
    const notes = c.notes.length ? `\n\nConsignes :\n${c.notes.map((n) => freeText(n)).join("\n")}` : "";
    const description = `${freeText(intro)}${notes}\n\n${steps.join("\n")}\n`;
    return {
      segmentIndex,
      sport: segment.sport,
      externalId,
      issues: c.issues,
      event: {
        category: "WORKOUT",
        // Date seule : l'API attend minuit (« T00:00:00 »), sans heure.
        start_date_local: `${ctx.date}T00:00:00`,
        type: TYPES[segment.sport],
        name,
        description,
        external_id: externalId,
      },
    };
  });
}
