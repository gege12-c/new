/**
 * Séance prévue et séance faite, étape par étape.
 *
 * Avec les courbes de l'activité (montre via intervals.icu, fichier FIT), les étapes prévues
 * (répétitions déroulées) y sont retrouvées l'une après l'autre : chacune commence où la précédente
 * finit et dure le temps (ou la distance) prévu, et chaque changement d'intensité prévu est recalé
 * sur les courbes (allure tirée de la distance en course et en natation, puissance à vélo), là où
 * l'intensité change le plus nettement près de l'endroit attendu. Les mesures de chaque étape sont
 * calculées sur ces courbes, indépendamment des tours enregistrés, qui peuvent manquer, se chevaucher
 * ou mêler tours au kilomètre et étapes de la séance.
 *
 * Sans courbes exploitables, ou si l'activité ne suit visiblement pas la séance (l'intensité ne
 * change pas dans le sens prévu), les efforts sont pris dans les tours, dans l'ordre : ceux marqués
 * « effort » quand la source distingue efforts et récupérations, sinon ceux de la durée prévue.
 *
 * Les cibles sont converties avec les seuils de l'athlète à la date de la séance ; rien n'est jugé
 * sans cible convertible ni mesure.
 */
import { expandWorkout, intensityPercent, resolveTarget, stepQuantities, type FlatStep } from "@/lib/workout/compute";
import { describeLength, describeTarget } from "@/lib/workout/format";
import { STEP_TYPE_LABELS, type SegmentSport, type StepType, type Target, type Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cleanLaps, type ActivityLap, type ActivityStreams } from "./streams";

/** Écart toléré autour de la cible avant de la dire manquée (arrondis, capteurs). */
const TOLERANCE = 0.02;
/** Effort court : l'allure vient de quelques dizaines de mètres de GPS, l'écart toléré est plus large. */
const SHORT_TOLERANCE = 0.05;
export const SHORT_STEP_S = 60;
/** Étape écourtée à moins de 10 % (ou 10 s) de sa durée prévue : non faite. */
const MIN_DONE_RATIO = 0.1;
const MIN_DONE_S = 10;
/** Part des changements d'intensité qui doivent aller dans le sens prévu pour se fier aux courbes. */
const MIN_AGREEMENT = 2 / 3;

export type EffortVerdict = "in" | "above" | "below" | "unknown";
type Metric = "power" | "heart_rate" | "pace";

export interface EffortRow {
  rank: number;
  /** « Échauffement », « Effort 2 », « Récupération 2 »… */
  name: string;
  /** Étape d'effort (« travail »). */
  effort: boolean;
  planned: { length: string; target: string | null } | null;
  /** partial : étape écourtée, l'activité s'arrête avant sa fin prévue. */
  actual: { durationS: number; value: string | null; partial: boolean } | null;
  verdict: EffortVerdict;
  /** Pour une allure : au-dessus = plus rapide. */
  metric: Metric | null;
}

export interface EffortComparison {
  rows: EffortRow[];
  /** Efforts prévus, et retrouvés dans l'activité. */
  planned: number;
  detected: number;
  /** Étapes retrouvées sur les courbes, ou efforts pris dans les tours. */
  method: "streams" | "laps";
}

const COMPARED: Target["metric"][] = ["power", "pace", "heart_rate"];

/** Mesures d'une étape faite. */
interface Measure {
  durationS: number;
  distanceM: number | null;
  speed: number | null;
  power: number | null;
  hr: number | null;
  partial: boolean;
}

// ---------------------------------------------------------------------------
// Cibles et verdicts
// ---------------------------------------------------------------------------

interface Goal {
  metric: Metric | null;
  range: { min: number; max: number } | null;
  text: string | null;
}

function goalOf(flat: FlatStep, sport: SegmentSport, thresholds: AthleteThresholds | undefined): Goal {
  const target = COMPARED.map((m) => flat.step.targets.find((t) => t.metric === m)).find(Boolean);
  if (!target) return { metric: null, range: null, text: null };
  const resolved = resolveTarget(target, sport, thresholds);
  if (resolved.ok && (resolved.target.metric === "power" || resolved.target.metric === "heart_rate" || resolved.target.metric === "pace")) {
    return {
      metric: resolved.target.metric,
      range: { min: Math.min(resolved.target.min, resolved.target.max), max: Math.max(resolved.target.min, resolved.target.max) },
      text: describeTarget(resolved.target as Target, sport),
    };
  }
  return { metric: null, range: null, text: describeTarget(target, sport) };
}

function measuredValue(measure: Measure, metric: Metric | null, sport: SegmentSport): number | null {
  if (metric === "power") return measure.power === null ? null : Math.round(measure.power);
  if (metric === "heart_rate") return measure.hr === null ? null : Math.round(measure.hr);
  if (metric === "pace" && measure.speed && measure.speed > 0) return Math.round((sport === "swim" ? 100 : 1000) / measure.speed);
  return null;
}

function formatValue(value: number, metric: Metric, sport: SegmentSport): string {
  if (metric === "power") return `${value} W`;
  if (metric === "heart_rate") return `${value} bpm`;
  return describeTarget({ metric: "pace", unit: sport === "swim" ? "sec_per_100m" : "sec_per_km", min: value, max: value }, sport);
}

function verdictOf(goal: Goal, value: number | null, durationS: number): EffortVerdict {
  if (!goal.range || value === null || !goal.metric) return "unknown";
  const tolerance = durationS < SHORT_STEP_S ? SHORT_TOLERANCE : TOLERANCE;
  const low = goal.range.min * (1 - tolerance);
  const high = goal.range.max * (1 + tolerance);
  // Allure : moins de secondes = plus rapide = au-dessus de la cible.
  if (goal.metric === "pace") return value < low ? "above" : value > high ? "below" : "in";
  return value > high ? "above" : value < low ? "below" : "in";
}

function row(rank: number, name: string, flat: FlatStep | null, sport: SegmentSport, thresholds: AthleteThresholds | undefined, measure: Measure | null): EffortRow {
  const goal = flat ? goalOf(flat, sport, thresholds) : { metric: null, range: null, text: null };
  const value = measure ? measuredValue(measure, goal.metric, sport) : null;
  return {
    rank,
    name,
    effort: flat?.step.type === "active",
    planned: flat ? { length: describeLength(flat.step.length, sport), target: goal.text } : null,
    actual: measure ? { durationS: Math.round(measure.durationS), value: value !== null && goal.metric ? formatValue(value, goal.metric, sport) : null, partial: measure.partial } : null,
    verdict: measure ? verdictOf(goal, value, measure.durationS) : "unknown",
    metric: goal.metric,
  };
}

/** Noms des étapes : « Effort 1 », « Récupération 1 »…, numérotées quand leur type revient. */
function stepNames(flats: FlatStep[]): string[] {
  const totals = new Map<StepType, number>();
  for (const f of flats) totals.set(f.step.type, (totals.get(f.step.type) ?? 0) + 1);
  const seen = new Map<StepType, number>();
  return flats.map((f) => {
    const n = (seen.get(f.step.type) ?? 0) + 1;
    seen.set(f.step.type, n);
    const base = f.step.type === "active" ? "Effort" : STEP_TYPE_LABELS[f.step.type];
    return f.step.type === "active" || (totals.get(f.step.type) ?? 0) > 1 ? `${base} ${n}` : base;
  });
}

const comparable = (flat: FlatStep) => flat.step.type === "active" || flat.step.targets.some((t) => COMPARED.includes(t.metric));

// ---------------------------------------------------------------------------
// Courbes : intensité, distance, mesures d'une fenêtre
// ---------------------------------------------------------------------------

interface Track {
  t: number[];
  /** Intensité qui sert à recaler les étapes (NaN : inconnue). */
  x: number[];
  distAt: ((time: number) => number) | null;
  power: (number | null)[];
  hr: (number | null)[];
  speed: (number | null)[];
  end: number;
}

const filled = (values: (number | null)[] | undefined) => (values ? values.filter((v) => v !== null).length : 0);

function interpolator(t: number[], values: (number | null)[]): ((time: number) => number) | null {
  const points = t.map((time, i) => [time, values[i]] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (points.length < 2) return null;
  return (time: number) => {
    if (time <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (time >= last[0]) return last[1];
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] <= time) lo = mid;
      else hi = mid;
    }
    const [t0, v0] = points[lo];
    const [t1, v1] = points[hi];
    return v0 + ((time - t0) / (t1 - t0)) * (v1 - v0);
  };
}

/** Courbes utilisables pour retrouver les étapes ; null sans mesure d'intensité. */
function trackOf(streams: ActivityStreams, sport: SegmentSport): Track | null {
  const { series } = streams;
  const t = series.time;
  if (t.length < 4) return null;
  const distAt = filled(series.distance) >= t.length / 2 ? interpolator(t, series.distance!) : null;
  let raw: (number | null)[] | null = null;
  if (sport === "bike" && filled(series.watts) >= t.length / 2) raw = series.watts!;
  else if (distAt) {
    // Vitesse tirée de la distance (différence centrée) : sans le lissage des vitesses reçues.
    raw = t.map((time, i) => {
      const a = t[Math.max(0, i - 1)];
      const b = t[Math.min(t.length - 1, i + 1)];
      return b > a ? (distAt(b) - distAt(a)) / (b - a) : null;
    });
  } else if (filled(series.speed) >= t.length / 2) raw = series.speed!;
  else if (filled(series.watts) >= t.length / 2) raw = series.watts!;
  if (!raw) return null;
  const values = raw;
  // Lissage léger sur trois mesures : les à-coups du GPS ne font pas un changement d'intensité.
  const x = values.map((_, i) => {
    const around = [values[i - 1], values[i], values[i + 1]].filter((v): v is number => typeof v === "number");
    return around.length ? around.reduce((s, v) => s + v, 0) / around.length : Number.NaN;
  });
  // Chaque mesure vaut pour son intervalle de temps : l'activité finit un intervalle après la dernière.
  const step = streams.sample_s > 0 ? streams.sample_s : t[t.length - 1] - t[t.length - 2];
  return { t, x, distAt, power: series.watts ?? [], hr: series.heartrate ?? [], speed: series.speed ?? [], end: t[t.length - 1] + step };
}

/** Premier indice dont le temps atteint `time` (temps croissants). */
function firstIndexAt(t: number[], time: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function windowMean(track: Track, values: ArrayLike<number | null>, from: number, to: number): number | null {
  let sum = 0;
  let n = 0;
  for (let i = firstIndexAt(track.t, from); i < track.t.length; i += 1) {
    if (track.t[i] >= to) break;
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

function measure(track: Track, from: number, to: number, partial: boolean): Measure {
  const durationS = to - from;
  const distanceM = track.distAt ? Math.max(0, track.distAt(to) - track.distAt(from)) : null;
  const speed = distanceM !== null && durationS > 0 ? distanceM / durationS : windowMean(track, track.speed, from, to);
  return { durationS, distanceM, speed, power: windowMean(track, track.power, from, to), hr: windowMean(track, track.hr, from, to), partial };
}

// ---------------------------------------------------------------------------
// Étapes retrouvées sur les courbes
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Niveau d'intensité prévu d'une étape (% du seuil), ou selon son type faute de cible. */
const TYPE_LEVEL: Record<StepType, number> = { active: 95, drill: 75, warmup: 65, cooldown: 65, recovery: 55, rest: 40, transition: 60 };
function plannedLevel(flat: FlatStep, thresholds: AthleteThresholds | undefined): number {
  return intensityPercent(flat.step, flat.sport, thresholds) ?? TYPE_LEVEL[flat.step.type];
}

/**
 * Changement d'intensité attendu vers `planned` (montée si dir = 1) : le point où il est le plus net,
 * parmi les plus nets le plus proche de l'endroit prévu, dans une fenêtre qui s'élargit avec la durée
 * de l'étape qui finit (une longue étape dérive plus).
 */
function refineBoundary(track: Track, planned: number, dir: 1 | -1, before: number, after: number, earliest: number): { at: number; contrast: number } {
  const span = clamp(Math.min(before, after) / 2, 4, 30);
  // Une étape de 20 s reste entre 16 et 24 s ; un échauffement de 15 min peut dériver d'une minute et demie.
  const reach = clamp(0.15 * before, 4, 90);
  const candidates: { at: number; score: number }[] = [];
  for (const at of track.t) {
    if (at < Math.max(earliest, planned - reach) || at > Math.min(track.end, planned + reach)) continue;
    const after_ = windowMean(track, track.x, at, at + span);
    const before_ = windowMean(track, track.x, at - span, at);
    if (after_ === null || before_ === null) continue;
    candidates.push({ at, score: dir * (after_ - before_) });
  }
  const best = Math.max(0, ...candidates.map((c) => c.score));
  if (best <= 0) return { at: planned, contrast: 0 };
  const peaks = candidates.filter((c, i) => c.score >= 0.6 * best && c.score >= (candidates[i - 1]?.score ?? -Infinity) && c.score >= (candidates[i + 1]?.score ?? -Infinity));
  const chosen = peaks.reduce((a, b) => (Math.abs(b.at - planned) < Math.abs(a.at - planned) ? b : a), peaks[0]);
  return { at: chosen.at, contrast: chosen.score };
}

/** Fenêtre de chaque étape prévue sur les courbes (null : étape non faite ou non retrouvée), et la confiance. */
function alignSteps(track: Track, flats: FlatStep[], sport: SegmentSport, thresholds: AthleteThresholds | undefined): { measures: (Measure | null)[]; reliable: boolean } {
  const measures: (Measure | null)[] = [];
  const levels = flats.map((f) => plannedLevel(f, thresholds));
  const durations = flats.map((f) => stepQuantities(f.step, sport, thresholds).duration.value);
  let cursor = track.t[0];
  let checked = 0;
  let agreed = 0;
  for (let k = 0; k < flats.length; k += 1) {
    const length = flats[k].step.length;
    if (cursor >= track.end - 1 || length.unit === "open" || length.unit === "reps") {
      // Fin de l'activité, ou durée libre : la suite n'est pas retrouvée.
      measures.push(...flats.slice(k).map(() => null));
      break;
    }
    let plannedEnd: number;
    if (length.unit === "time") plannedEnd = cursor + length.seconds;
    else if (track.distAt) {
      const goal = track.distAt(cursor) + length.meters;
      const reached = track.t.find((time) => time > cursor && track.distAt!(time) >= goal);
      plannedEnd = reached ?? Number.POSITIVE_INFINITY;
    } else plannedEnd = cursor + (durations[k] ?? 0);
    const plannedS = Math.max(1, (Number.isFinite(plannedEnd) ? plannedEnd : track.end) - cursor);
    let stepEnd = Math.min(plannedEnd, track.end);
    const next = k + 1 < flats.length ? k + 1 : null;
    if (next !== null && stepEnd < track.end) {
      const gap = levels[next] - levels[k];
      if (Math.abs(gap) >= 3) {
        const dir = gap > 0 ? 1 : -1;
        const refined = refineBoundary(track, stepEnd, dir, plannedS, durations[next] ?? plannedS, cursor + Math.max(2, 0.3 * plannedS));
        stepEnd = refined.at;
      }
    }
    const done = stepEnd - cursor;
    const partial = stepEnd >= track.end && plannedEnd > track.end + 1;
    measures.push(done >= Math.max(MIN_DONE_S, MIN_DONE_RATIO * plannedS) || !partial ? measure(track, cursor, stepEnd, partial) : null);
    cursor = stepEnd;
  }
  // L'intensité mesurée change-t-elle dans le sens prévu d'une étape à l'autre ?
  for (let k = 0; k + 1 < flats.length; k += 1) {
    const gap = levels[k + 1] - levels[k];
    const a = measures[k];
    const b = measures[k + 1];
    if (Math.abs(gap) < 3 || !a || !b || b.partial) continue;
    const ia = intensityOf(a, sport);
    const ib = intensityOf(b, sport);
    if (ia === null || ib === null) continue;
    checked += 1;
    if (Math.sign(ib - ia) === Math.sign(gap)) agreed += 1;
  }
  return { measures, reliable: checked === 0 ? measures.some(Boolean) : agreed / checked >= MIN_AGREEMENT };
}

const intensityOf = (m: Measure, sport: SegmentSport) => (sport === "bike" && m.power !== null ? m.power : (m.speed ?? m.power));

// ---------------------------------------------------------------------------
// Efforts pris dans les tours
// ---------------------------------------------------------------------------

const lapMeasure = (lap: ActivityLap): Measure => ({
  durationS: lap.duration_s,
  distanceM: lap.distance_m,
  speed: lap.avg_speed_mps ?? (lap.distance_m !== null && lap.duration_s > 0 ? lap.distance_m / lap.duration_s : null),
  power: lap.avg_power,
  hr: lap.avg_hr,
  partial: false,
});

/** Tours qui correspondent aux efforts prévus, dans l'ordre. */
function lapsForEfforts(laps: ActivityLap[], efforts: FlatStep[], sport: SegmentSport, thresholds: AthleteThresholds | undefined): ActivityLap[] {
  const cleaned = cleanLaps(laps);
  const kinds = new Set(cleaned.map((l) => l.kind));
  // La source distingue efforts et récupérations : ses efforts, dans l'ordre.
  if (kinds.has("work") && kinds.size > 1) return cleaned.filter((l) => l.kind === "work");
  // Sinon, les tours de la durée prévue de chaque effort (à 25 % près), dans l'ordre ; quand efforts et
  // récupérations ont la même durée, seuls les tours plus intenses que leurs voisins sont des efforts.
  const intensity = (l: ActivityLap | undefined) => (l ? (sport === "bike" ? (l.avg_power ?? l.avg_speed_mps) : (l.avg_speed_mps ?? l.avg_power)) : null);
  const peak = (i: number) => {
    const own = intensity(cleaned[i]);
    if (own === null) return true;
    // Voisins qui le touchent (à quelques secondes près) et de même durée : ses récupérations possibles.
    const lap = cleaned[i];
    const touching = (n: ActivityLap | undefined) => !!n && (Math.abs(n.start_s + n.duration_s - lap.start_s) <= 5 || Math.abs(lap.start_s + lap.duration_s - n.start_s) <= 5);
    return [cleaned[i - 1], cleaned[i + 1]].every((n) => {
      const other = intensity(n);
      return !touching(n) || other === null || Math.abs(n!.duration_s - lap.duration_s) > 0.25 * lap.duration_s || own >= other;
    });
  };
  const picked: ActivityLap[] = [];
  let from = 0;
  for (const flat of efforts) {
    const planned = stepQuantities(flat.step, sport, thresholds).duration.value;
    if (!planned) break;
    const index = cleaned.findIndex((l, i) => i >= from && Math.abs(l.duration_s - planned) <= 0.25 * planned && peak(i));
    if (index === -1) break;
    picked.push(cleaned[index]);
    from = index + 1;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Comparaison
// ---------------------------------------------------------------------------

/**
 * Comparaison d'une séance et d'une activité de la même discipline : courbes de l'activité (ou
 * seulement ses tours), seuils à la date de la séance ; null si rien à comparer.
 */
export function compareEfforts(
  workout: Workout,
  thresholds: AthleteThresholds | undefined,
  streams: Pick<ActivityStreams, "laps"> & Partial<Pick<ActivityStreams, "series" | "sample_s">>,
  activitySport: string,
): EffortComparison | null {
  const sport = activitySport as SegmentSport;
  // Les transitions se font hors de l'activité (entre deux disciplines).
  const flats = expandWorkout(workout).filter((flat) => flat.sport === sport && flat.step.type !== "transition");
  const efforts = flats.filter((flat) => flat.step.type === "active" && flat.step.length.unit !== "reps");
  if (!flats.length || !efforts.length) return null;

  const track = streams.series ? trackOf(streams as ActivityStreams, sport) : null;
  if (track) {
    const { measures, reliable } = alignSteps(track, flats, sport, thresholds);
    if (reliable) {
      const names = stepNames(flats);
      const rows = flats
        .map((flat, k) => ({ flat, k }))
        .filter(({ flat }) => comparable(flat))
        .map(({ flat, k }, index) => row(index + 1, names[k], flat, sport, thresholds, measures[k]));
      return { rows, planned: efforts.length, detected: rows.filter((r) => r.effort && r.actual && !r.actual.partial).length, method: "streams" };
    }
  }

  const laps = lapsForEfforts(streams.laps, efforts, sport, thresholds);
  if (!laps.length) return null;
  const count = Math.max(efforts.length, laps.length);
  const rows = Array.from({ length: count }, (_, i) => row(i + 1, `Effort ${i + 1}`, efforts[i] ?? null, sport, thresholds, laps[i] ? lapMeasure(laps[i]) : null));
  return { rows, planned: efforts.length, detected: laps.length, method: "laps" };
}
