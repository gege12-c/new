/**
 * Séance écrite en texte, à la manière de l’éditeur d’intervals.icu, convertie au format de séance
 * de TriCoach. Une ligne par étape, commençant par un tiret ; « 4x » ouvre une répétition jusqu’à la
 * ligne vide suivante ; une ligne sans tiret est un intitulé pour les étapes qui suivent.
 *
 *   Échauffement
 *   - 15m 55-70%
 *
 *   4x
 *   - 8m 95-105% 85-95rpm Seuil
 *   - 3m Z1 Récupération
 *
 *   - 10m 60% Retour au calme
 *
 * Durées : 1h30m, 15m, 15min, 1m30s, 45s. Distances : 2km, 400mtr (en natation, 400m = mètres).
 * Cibles : 220w, 200-240w ; 95% ou 90-95% (FTP à vélo, allure seuil en course et natation) ;
 * Z2 (zone de puissance à vélo, de FC sinon) ; Z2 HR, Z3 Pace ; 140-150bpm ; 90% LTHR ; 80% HR ;
 * 4:30/km, 4:20-4:30/km, 1:40/100m ; 90rpm (vélo), 175spm (course) ; RPE 6, RPE 6-7.
 * Rien n’est deviné : ce qui n’est pas reconnu devient l’intitulé de l’étape.
 */
import { WorkoutSchema, type SegmentSport, type StepType, type Target, type Workout, type WorkoutNode } from "./schema";

export interface TextIssue {
  line: number | null;
  message: string;
}

export interface TextParseResult {
  workout: Workout | null;
  issues: TextIssue[];
  /** Nombre d’étapes lues (répétitions non déroulées). */
  steps: number;
}

type Step = Extract<WorkoutNode, { kind: "step" }>;
type Repeat = Extract<WorkoutNode, { kind: "repeat" }>;

const TYPE_HINTS: [RegExp, StepType][] = [
  [/(échauff|echauff|warm ?up|^wu\b)/i, "warmup"],
  [/(retour au calme|cool ?down|^cd\b)/i, "cooldown"],
  [/(récup|recup|recovery|souple|easy)/i, "recovery"],
  [/(repos|\brest\b|pause)/i, "rest"],
  [/(éducatif|educatif|drill|technique)/i, "drill"],
  [/transition/i, "transition"],
];

export function inferStepType(label: string | undefined): StepType {
  if (!label) return "active";
  for (const [pattern, type] of TYPE_HINTS) if (pattern.test(label)) return type;
  return "active";
}

const range = (a: string, b?: string) => {
  const min = Number(a.replace(",", "."));
  const max = b === undefined ? min : Number(b.replace(",", "."));
  return min <= max ? { min, max } : { min: max, max: min };
};
const clock = (value: string) => {
  const [m, s] = value.split(":").map(Number);
  return m * 60 + s;
};

/** Durée « 1h30m », « 15m », « 15min », « 1m30s », « 45s » → secondes ; null si ce n’en est pas une. */
export function parseDuration(token: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)(?:m|min))?(?:(\d+)s)?$/i.exec(token);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

/** Distance « 2km », « 1,5km », « 400mtr » (et « 400m » en natation) → mètres. */
export function parseDistance(token: string, sport: SegmentSport): number | null {
  let match = /^(\d+(?:[.,]\d+)?)km$/i.exec(token);
  if (match) return Math.round(Number(match[1].replace(",", ".")) * 1000);
  match = /^(\d+)mtr$/i.exec(token);
  if (match) return Number(match[1]);
  if (sport === "swim") {
    match = /^(\d+)m$/i.exec(token);
    if (match) return Number(match[1]);
  }
  return null;
}

interface StepParse {
  length?: Step["length"];
  targets: Target[];
  words: string[];
}

/** Une ligne d’étape (sans le tiret). */
function parseStep(text: string, sport: SegmentSport): StepParse {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const out: StepParse = { targets: [], words: [] };
  const add = (target: Target) => {
    // Une cible par mesure : la première l’emporte, les suivantes restent dans l’intitulé.
    if (out.targets.some((t) => t.metric === target.metric)) return false;
    out.targets.push(target);
    return true;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1]?.toLowerCase();
    if (!out.length) {
      const distance = parseDistance(token, sport);
      if (distance) {
        out.length = { unit: "distance", meters: distance };
        continue;
      }
      const seconds = parseDuration(token);
      if (seconds) {
        out.length = { unit: "time", seconds };
        continue;
      }
    }
    let match = /^(\d+)(?:-(\d+))?w$/i.exec(token);
    if (match && add({ metric: "power", unit: "watts", ...range(match[1], match[2]) })) continue;
    match = /^(\d+)(?:-(\d+))?bpm$/i.exec(token);
    if (match && add({ metric: "heart_rate", unit: "bpm", ...range(match[1], match[2]) })) continue;
    match = /^(\d+)(?:-(\d+))?rpm$/i.exec(token);
    if (match && add({ metric: "cadence", unit: "rpm", ...range(match[1], match[2]) })) continue;
    match = /^(\d+)(?:-(\d+))?spm$/i.exec(token);
    if (match && add({ metric: "cadence", unit: "spm", ...range(match[1], match[2]) })) continue;
    match = /^(\d{1,2}:\d{2})(?:\/(km|100m))?(?:-(\d{1,2}:\d{2}))?\/(km|100m)$/i.exec(token);
    if (match) {
      const unit = match[4].toLowerCase() === "km" ? "sec_per_km" : "sec_per_100m";
      const a = clock(match[1]);
      const b = match[3] ? clock(match[3]) : a;
      if (add({ metric: "pace", unit, min: Math.min(a, b), max: Math.max(a, b) })) {
        if (next === "pace") i += 1;
        continue;
      }
    }
    match = /^(\d+(?:[.,]\d+)?)(?:-(\d+(?:[.,]\d+)?))?%$/.exec(token);
    if (match) {
      const values = range(match[1], match[2]);
      const target: Target | null =
        next === "lthr"
          ? { metric: "heart_rate", unit: "percent_lthr", ...values }
          : next === "hr"
            ? { metric: "heart_rate", unit: "percent_max_hr", ...values }
            : next === "pace" || sport === "run" || sport === "swim"
              ? { metric: "pace", unit: "percent_threshold", ...values }
              : sport === "bike"
                ? { metric: "power", unit: "percent_ftp", ...values }
                : null;
      if (target && add(target)) {
        if (next === "lthr" || next === "hr" || next === "pace") i += 1;
        continue;
      }
    }
    match = /^z(\d)(?:-z?(\d))?$/i.exec(token);
    if (match) {
      const values = range(match[1], match[2]);
      const target: Target =
        next === "hr"
          ? { metric: "heart_rate", unit: "zone", ...values }
          : next === "pace"
            ? { metric: "pace", unit: "zone", ...values }
            : sport === "bike"
              ? { metric: "power", unit: "zone", ...values }
              : { metric: "heart_rate", unit: "zone", ...values };
      if (add(target)) {
        if (next === "hr" || next === "pace") i += 1;
        continue;
      }
    }
    if (/^rpe$/i.test(token) && tokens[i + 1]) {
      match = /^(\d+)(?:-(\d+))?$/.exec(tokens[i + 1]);
      if (match && add({ metric: "rpe", unit: "scale", ...range(match[1], match[2]) })) {
        i += 1;
        continue;
      }
    }
    match = /^rpe(\d+)(?:-(\d+))?$/i.exec(token);
    if (match && add({ metric: "rpe", unit: "scale", ...range(match[1], match[2]) })) continue;
    out.words.push(token);
  }
  return out;
}

/** Texte → séance d’une discipline (une seule partie), avec les problèmes ligne par ligne. */
export function parseWorkoutText(text: string, sport: SegmentSport): TextParseResult {
  const issues: TextIssue[] = [];
  const nodes: WorkoutNode[] = [];
  let counter = 0;
  const id = (prefix: string) => `${prefix}${(counter += 1)}`;
  let header: string | undefined;
  let repeat: Repeat | null = null;
  let steps = 0;

  const closeRepeat = (line: number) => {
    if (!repeat) return;
    if (!repeat.steps.length) issues.push({ line, message: `Répétition « ${repeat.count}x » sans étape : ajoutez des lignes « - … » juste en dessous.` });
    else nodes.push(repeat);
    repeat = null;
  };

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (!content) {
      // Une ligne vide clôt la répétition et la section en cours.
      closeRepeat(line);
      header = undefined;
      return;
    }
    const repeatMatch = /^(\d+)\s*[x×]\s*(.*)$/i.exec(content);
    if (repeatMatch && !/^[-–•*]/.test(content)) {
      closeRepeat(line);
      const count = Number(repeatMatch[1]);
      if (count < 1 || count > 99) {
        issues.push({ line, message: "Une répétition va de 1x à 99x." });
        return;
      }
      repeat = { kind: "repeat", id: id("r"), count, steps: [], ...(repeatMatch[2] ? { label: repeatMatch[2].slice(0, 80) } : {}) };
      header = undefined;
      return;
    }
    const stepMatch = /^[-–•*]\s*(.*)$/.exec(content);
    if (!stepMatch) {
      // Intitulé de section : il nomme les étapes qui suivent (sans leur propre intitulé).
      closeRepeat(line);
      header = content.slice(0, 80);
      return;
    }
    const parsed = parseStep(stepMatch[1], sport);
    if (!parsed.length) {
      issues.push({ line, message: "Durée ou distance manquante (par exemple 15m, 1h30m, 30s, 2km, 400mtr)." });
      return;
    }
    const label = parsed.words.join(" ").slice(0, 80) || undefined;
    const open = repeat as Repeat | null;
    const step: Step = {
      kind: "step",
      id: id("t"),
      type: inferStepType(label ?? open?.label ?? header),
      length: parsed.length,
      targets: parsed.targets,
      ...(label ? { label } : header && !repeat ? { label: header } : {}),
    };
    steps += 1;
    const current = repeat as Repeat | null;
    if (current) current.steps.push(step);
    else nodes.push(step);
  });
  closeRepeat(lines.length);

  if (!nodes.length) {
    if (!issues.length) issues.push({ line: null, message: "Écrivez au moins une étape, par exemple « - 15m 55-70% »." });
    return { workout: null, issues, steps };
  }
  const workout = WorkoutSchema.safeParse({ schemaVersion: 1, segments: [{ id: "s1", sport, steps: nodes }] });
  if (!workout.success) {
    return { workout: null, issues: [...issues, ...workout.error.issues.slice(0, 3).map((i) => ({ line: null, message: i.message }))], steps };
  }
  return { workout: workout.data, issues, steps };
}
