/**
 * Courbes d'une activité (puissance, fréquence cardiaque, vitesse, cadence, altitude) et ses
 * intervalles, pour l'analyse du réalisé.
 *
 * Les courbes sont réduites à quelques centaines de points (moyenne par tranche de quelques
 * secondes) : assez pour lire une séance, sans alourdir la base. Les meilleures puissances sont
 * calculées avant réduction, sur la courbe seconde par seconde. Rien n'est deviné : une mesure que
 * l'appareil n'a pas enregistrée reste absente, une pause reste un trou.
 */
import { z } from "zod";

/** Mesures gardées, dans l'ordre d'affichage. */
export const STREAM_METRICS = ["watts", "heartrate", "speed", "cadence", "altitude"] as const;
export type StreamMetric = (typeof STREAM_METRICS)[number];

/** Au plus autant de points par courbe : 1 toutes les 5 s pour une heure, toutes les 25 s pour cinq. */
export const STREAM_MAX_POINTS = 720;
/** Meilleures puissances moyennes : 5 s, 1 min, 5 min, 20 min, 60 min. */
export const POWER_BEST_DURATIONS = [5, 60, 300, 1200, 3600] as const;
export type PowerBestDuration = (typeof POWER_BEST_DURATIONS)[number];
/** Intervalles gardés au plus par activité. */
export const MAX_LAPS = 300;
/** Longueur de courbe lue au plus (48 h à une mesure par seconde). */
const MAX_RAW_LENGTH = 172_800;
/** Points mesurés au moins pour tracer une courbe. */
const MIN_FILLED_POINTS = 10;
/** Écart au-delà duquel deux mesures sont séparées par une pause (et non tenues). */
const HOLD_LIMIT_S = 5;

type Values = (number | null)[];

/** Courbes telles que reçues (une valeur par mesure enregistrée), alignées sur `time`. */
export interface RawStreams {
  /** Secondes depuis le départ, croissantes ; absent : une mesure par seconde. */
  time?: Values;
  watts?: Values;
  heartrate?: Values;
  cadence?: Values;
  /** Vitesse, m/s. */
  speed?: Values;
  /** Altitude, m. */
  altitude?: Values;
  /** Distance cumulée, m. */
  distance?: Values;
}

const BOUNDS: Record<StreamMetric | "distance", { min: number; max: number; digits: number }> = {
  watts: { min: 0, max: 3000, digits: 0 },
  heartrate: { min: 20, max: 260, digits: 0 },
  cadence: { min: 0, max: 300, digits: 0 },
  speed: { min: 0, max: 40, digits: 2 },
  altitude: { min: -500, max: 9000, digits: 1 },
  distance: { min: 0, max: 2_000_000, digits: 0 },
};

const valid = (value: unknown, metric: StreamMetric | "distance"): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= BOUNDS[metric].min && value <= BOUNDS[metric].max;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export type StreamSeries = { time: number[] } & Partial<Record<StreamMetric | "distance", Values>>;

export interface ActivityLap {
  /** Début et durée, en secondes depuis le départ de l'activité. */
  start_s: number;
  duration_s: number;
  distance_m: number | null;
  avg_power: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  avg_speed_mps: number | null;
  /** Effort ou récupération, quand la source le dit. */
  kind: "work" | "recovery" | null;
  label: string | null;
}

export type PowerBests = Partial<Record<`${PowerBestDuration}`, number>>;

export interface ActivityStreams {
  sample_s: number;
  series: StreamSeries;
  laps: ActivityLap[];
  /** « detected » : intervalles détectés par intervals.icu ; « device » : tours enregistrés par l'appareil. */
  laps_origin: "detected" | "device" | null;
  bests: PowerBests;
}

/** Temps de chaque mesure : celui reçu s'il est cohérent (croissant), sinon une mesure par seconde. */
function timeline(raw: RawStreams): number[] | null {
  const length = Math.max(0, ...(["time", "distance", ...STREAM_METRICS] as const).map((key) => raw[key]?.length ?? 0));
  if (!length || length > MAX_RAW_LENGTH) return null;
  const time = raw.time;
  if (time && time.length === length) {
    const out: number[] = [];
    let previous = -1;
    for (const t of time) {
      if (typeof t !== "number" || !Number.isFinite(t) || t < previous || t > MAX_RAW_LENGTH) return null;
      out.push(Math.round(t));
      previous = t;
    }
    return out;
  }
  return Array.from({ length }, (_, i) => i);
}

/**
 * Réduit les courbes à STREAM_MAX_POINTS points au plus : moyenne de chaque tranche de `sample_s`
 * secondes (distance : la plus grande valeur de la tranche). Une tranche sans mesure vaut null.
 * Renvoie null s'il n'y a rien à tracer.
 */
export function reduceStreams(raw: RawStreams, maxPoints = STREAM_MAX_POINTS): { sample_s: number; series: StreamSeries } | null {
  const time = timeline(raw);
  if (!time) return null;
  const duration = time[time.length - 1] ?? 0;
  const sample_s = Math.max(1, Math.ceil((duration + 1) / maxPoints));
  const buckets = Math.floor(duration / sample_s) + 1;
  const series: StreamSeries = { time: Array.from({ length: buckets }, (_, i) => i * sample_s) };
  let any = false;
  for (const metric of [...STREAM_METRICS, "distance"] as const) {
    const values = raw[metric];
    if (!values || values.length !== time.length) continue;
    const sums = new Float64Array(buckets);
    const counts = new Uint32Array(buckets);
    let present = false;
    values.forEach((value, i) => {
      if (!valid(value, metric)) return;
      const bucket = Math.floor(time[i] / sample_s);
      if (metric === "distance") sums[bucket] = Math.max(sums[bucket], value);
      else sums[bucket] += value;
      counts[bucket] += 1;
      present = true;
    });
    // Quelques mesures éparses (départ et arrivée seulement) ne font pas une courbe.
    const filled = counts.reduce((n, count) => n + (count ? 1 : 0), 0);
    if (!present || filled < Math.min(MIN_FILLED_POINTS, buckets)) continue;
    const { digits } = BOUNDS[metric];
    series[metric] = Array.from(counts, (count, b) => (count ? round(metric === "distance" ? sums[b] : sums[b] / count, digits) : null));
    if (metric !== "distance") any = true;
  }
  return any && buckets >= 2 ? { sample_s, series } : null;
}

/**
 * Meilleures puissances moyennes, sur la courbe seconde par seconde : une mesure vaut jusqu'à la
 * suivante (5 s au plus) ; au-delà, c'est une pause, comptée à 0 W, comme à l'arrêt.
 */
export function powerBests(raw: RawStreams): PowerBests {
  const time = timeline(raw);
  const watts = raw.watts;
  if (!time || !watts || watts.length !== time.length) return {};
  const duration = time[time.length - 1] + 1;
  const perSecond = new Float64Array(duration);
  let measured = false;
  for (let i = 0; i < time.length; i += 1) {
    const value = watts[i];
    if (!valid(value, "watts")) continue;
    measured = true;
    const until = i + 1 < time.length ? time[i + 1] : time[i] + 1;
    const hold = until - time[i] <= HOLD_LIMIT_S ? Math.max(1, until - time[i]) : 1;
    for (let k = 0; k < hold && time[i] + k < duration; k += 1) perSecond[time[i] + k] = value;
  }
  if (!measured) return {};
  const bests: PowerBests = {};
  for (const window of POWER_BEST_DURATIONS) {
    if (window > duration) break;
    let sum = 0;
    for (let i = 0; i < window; i += 1) sum += perSecond[i];
    let best = sum;
    for (let i = window; i < duration; i += 1) {
      sum += perSecond[i] - perSecond[i - window];
      if (sum > best) best = sum;
    }
    const average = Math.round(best / window);
    if (average > 0) bests[`${window}`] = average;
  }
  return bests;
}

// ---------------------------------------------------------------------------
// intervals.icu
// ---------------------------------------------------------------------------

/** Courbes demandées à intervals.icu (noms de son API) et leur nom ici. */
export const INTERVALS_STREAM_TYPES: Record<string, keyof RawStreams> = {
  time: "time",
  watts: "watts",
  heartrate: "heartrate",
  cadence: "cadence",
  velocity_smooth: "speed",
  altitude: "altitude",
  distance: "distance",
};

const numbers = (data: unknown): Values | null =>
  Array.isArray(data) && data.length <= MAX_RAW_LENGTH ? data.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)) : null;

/**
 * Courbes d'intervals.icu (GET /activity/{id}/streams.json) : une liste d'objets { type, data }.
 * Une réponse rangée par nom ({ watts: […] }) est lue aussi ; un type inconnu est ignoré.
 */
export function intervalsStreams(body: unknown): RawStreams {
  const out: RawStreams = {};
  const put = (type: unknown, data: unknown) => {
    const key = typeof type === "string" ? INTERVALS_STREAM_TYPES[type] : undefined;
    const values = numbers(data);
    if (key && values && !out[key]) out[key] = values;
  };
  if (Array.isArray(body)) {
    for (const stream of body) if (stream && typeof stream === "object") put((stream as { type?: unknown }).type, (stream as { data?: unknown }).data);
  } else if (body && typeof body === "object") {
    for (const [type, data] of Object.entries(body)) put(type, data);
  }
  return out;
}

const metric = z.number().nullish().catch(null);
const IntervalsIntervalSchema = z
  .object({
    type: z.string().nullish().catch(null),
    label: z.string().nullish().catch(null),
    start_time: metric,
    end_time: metric,
    start_index: metric,
    end_index: metric,
    elapsed_time: metric,
    distance: metric,
    average_watts: metric,
    average_heartrate: metric,
    max_heartrate: metric,
    average_cadence: metric,
    average_speed: metric,
  })
  .loose();

const boundedOrNull = (value: number | null | undefined, min: number, max: number, digits = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? round(value, digits) : null;

/** Un intervalle, bornes et mesures contrôlées ; null s'il ne tient pas debout. */
export function lap(input: Omit<ActivityLap, "label" | "kind"> & { kind?: ActivityLap["kind"]; label?: string | null }): ActivityLap | null {
  const start = boundedOrNull(input.start_s, 0, MAX_RAW_LENGTH);
  const duration = boundedOrNull(input.duration_s, 1, MAX_RAW_LENGTH);
  if (start === null || duration === null) return null;
  return {
    start_s: start,
    duration_s: duration,
    distance_m: boundedOrNull(input.distance_m, 0, 2_000_000),
    avg_power: boundedOrNull(input.avg_power, 0, 3000),
    avg_hr: boundedOrNull(input.avg_hr, 20, 260),
    max_hr: boundedOrNull(input.max_hr, 20, 260),
    avg_cadence: boundedOrNull(input.avg_cadence, 0, 300),
    avg_speed_mps: boundedOrNull(input.avg_speed_mps, 0, 40, 3),
    kind: input.kind ?? null,
    label: input.label?.trim().slice(0, 80) || null,
  };
}

/** Intervalles détectés par intervals.icu (GET /activity/{id}/intervals : { icu_intervals: […] }). */
export function intervalsLaps(body: unknown): ActivityLap[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { icu_intervals?: unknown }).icu_intervals)
      ? (body as { icu_intervals: unknown[] }).icu_intervals
      : [];
  const laps: ActivityLap[] = [];
  for (const raw of list.slice(0, MAX_LAPS)) {
    const parsed = IntervalsIntervalSchema.safeParse(raw);
    if (!parsed.success) continue;
    const i = parsed.data;
    const start = i.start_time ?? i.start_index;
    const end = i.end_time ?? i.end_index;
    const duration = i.elapsed_time ?? (typeof start === "number" && typeof end === "number" ? end - start : null);
    const type = (i.type ?? "").toUpperCase();
    const item = lap({
      start_s: start ?? -1,
      duration_s: duration ?? 0,
      distance_m: i.distance ?? null,
      avg_power: i.average_watts ?? null,
      avg_hr: i.average_heartrate ?? null,
      max_hr: i.max_heartrate ?? null,
      avg_cadence: i.average_cadence ?? null,
      avg_speed_mps: i.average_speed ?? null,
      kind: type === "WORK" ? "work" : type === "RECOVERY" ? "recovery" : null,
      label: i.label ?? null,
    });
    if (item) laps.push(item);
  }
  return laps.sort((a, b) => a.start_s - b.start_s);
}

// ---------------------------------------------------------------------------
// Lecture en base
// ---------------------------------------------------------------------------

const seriesValues = z.array(z.number().nullable()).max(STREAM_MAX_POINTS * 2);
export const StoredSeriesSchema = z
  .object({
    time: z.array(z.number()).min(2).max(STREAM_MAX_POINTS * 2),
    watts: seriesValues.optional(),
    heartrate: seriesValues.optional(),
    cadence: seriesValues.optional(),
    speed: seriesValues.optional(),
    altitude: seriesValues.optional(),
    distance: seriesValues.optional(),
  })
  .refine((s) => (["watts", "heartrate", "cadence", "speed", "altitude", "distance"] as const).every((k) => !s[k] || s[k]!.length === s.time.length), {
    message: "Courbes de longueurs différentes.",
  });

const nullableNumber = z.number().nullable();
export const StoredLapSchema = z.object({
  start_s: z.number().min(0),
  duration_s: z.number().positive(),
  distance_m: nullableNumber,
  avg_power: nullableNumber,
  avg_hr: nullableNumber,
  max_hr: nullableNumber,
  avg_cadence: nullableNumber,
  avg_speed_mps: nullableNumber,
  kind: z.enum(["work", "recovery"]).nullable(),
  label: z.string().max(80).nullable(),
});

export const StoredBestsSchema = z.object(Object.fromEntries(POWER_BEST_DURATIONS.map((d) => [`${d}`, z.number().int().positive().optional()]))).partial();

export const StoredStreamsSchema = z.object({
  sample_s: z.number().int().min(1).max(3600),
  series: StoredSeriesSchema,
  laps: z.array(StoredLapSchema).max(MAX_LAPS),
  laps_origin: z.enum(["detected", "device"]).nullable(),
  bests: StoredBestsSchema,
});

/** Ligne lue en base → courbes prêtes à tracer ; null si elle est illisible (rien n'est affiché). */
export function readStoredStreams(row: unknown): ActivityStreams | null {
  const parsed = StoredStreamsSchema.safeParse(row);
  return parsed.success ? (parsed.data as ActivityStreams) : null;
}

/** Mesures présentes dans des courbes (au moins une valeur). */
export function availableMetrics(series: StreamSeries): StreamMetric[] {
  return STREAM_METRICS.filter((m) => series[m]?.some((v) => v !== null));
}
