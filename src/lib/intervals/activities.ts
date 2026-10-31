/**
 * Activités faites, reçues d'intervals.icu → format normalisé de TriCoach.
 *
 * intervals.icu reçoit les activités des montres (Suunto, Garmin, COROS…) et les résume (durées,
 * distance, fréquence cardiaque, puissance). Celles qu'il tient de Strava ne sont pas transmises par
 * son API (règles de Strava) : elles arrivent sans données et sont ignorées ici, sans être devinées.
 */
import { z } from "zod";
import { metrics, shortText, type ActivityFields } from "@/lib/activities/schema";
import { stravaSport } from "@/lib/strava/normalize";
import { zonedLocalToUtc } from "@/lib/time-zone";

export { zonedLocalToUtc };

/** Courbes lues : les activités des 90 derniers jours. */
export const INTERVALS_HISTORY_DAYS = 90;
/** Historique reçu une fois : un an, pour que la condition (constante de 42 jours) ne parte pas de zéro. */
export const INTERVALS_FULL_HISTORY_DAYS = 365;
/** Réceptions suivantes : la période relue, où les activités retirées chez intervals.icu le sont aussi ici. */
export const INTERVALS_RECENT_DAYS = 14;

const number = z.number().nullish().catch(null);
const text = z.string().nullish().catch(null);

export const IntervalsActivitySchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    start_date_local: text,
    start_date: text,
    timezone: text,
    type: text,
    name: text,
    source: text,
    _note: text,
    file_type: text,
    elapsed_time: number,
    moving_time: number,
    distance: number,
    total_elevation_gain: number,
    average_heartrate: number,
    max_heartrate: number,
    icu_average_watts: number,
    average_watts: number,
    icu_weighted_avg_watts: number,
    weighted_average_watts: number,
    max_watts: number,
    p_max: number,
    average_cadence: number,
    average_speed: number,
    trainer: z.boolean().nullish().catch(null),
    device_name: text,
    icu_training_load: number,
  })
  .loose();
export type IntervalsActivity = z.infer<typeof IntervalsActivitySchema>;

export type IntervalsActivityOutcome =
  /** sourceLoad : charge calculée par intervals.icu (avec ses seuils), null s'il n'en donne pas. */
  | { kind: "activity"; fields: ActivityFields; sourceLoad: number | null }
  /** Reçue de Strava par intervals.icu : non transmise par son API. */
  | { kind: "strava" }
  | { kind: "unreadable" };

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/;

function validTimeZone(value: string | null | undefined): string | null {
  if (!value || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(value)) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value.slice(0, 64);
  } catch {
    return null;
  }
}

/** Une activité d'intervals.icu, normalisée ; ou la raison pour laquelle elle ne peut pas l'être. */
export function normalizeIntervalsActivity(raw: unknown, athleteTimeZone: string): IntervalsActivityOutcome {
  const parsed = IntervalsActivitySchema.safeParse(raw);
  if (!parsed.success) return { kind: "unreadable" };
  const a = parsed.data;
  if ((a.source ?? "").toUpperCase() === "STRAVA" || a._note) return { kind: "strava" };
  const local = a.start_date_local?.match(LOCAL);
  if (!local || !a.type || a.id.length > 100) return { kind: "unreadable" };
  const localStart = `${local[1]}T${local[2]}${local[3] ?? ":00"}`;
  const timeZone = validTimeZone(a.timezone) ?? athleteTimeZone;
  let start: Date;
  if (a.start_date) {
    // Instant UTC ; une valeur sans indicateur de fuseau est lue en UTC.
    start = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(a.start_date) ? a.start_date : `${a.start_date}Z`);
  } else {
    start = zonedLocalToUtc(localStart, timeZone);
  }
  if (Number.isNaN(start.getTime())) return { kind: "unreadable" };

  const load = a.icu_training_load;
  return {
    kind: "activity",
    sourceLoad: typeof load === "number" && Number.isFinite(load) && load >= 0 && load <= 2000 ? Math.round(load * 10) / 10 : null,
    fields: {
      external_id: a.id,
      group_key: null,
      // intervals.icu reprend les types d'activité de Strava (Ride, VirtualRide, Run, Swim…).
      sport: a.type === "OpenWaterSwim" ? "swim" : stravaSport(a.type),
      sport_detail: shortText(a.type, 60),
      name: shortText(a.name, 200),
      start_time: start.toISOString(),
      local_date: local[1],
      local_start_time: localStart.slice(11, 19),
      timezone: timeZone,
      ...metrics({
        elapsed_s: a.elapsed_time,
        moving_s: a.moving_time,
        distance_m: a.distance,
        elevation_gain_m: a.total_elevation_gain,
        avg_hr: a.average_heartrate,
        max_hr: a.max_heartrate,
        avg_power: a.icu_average_watts ?? a.average_watts,
        weighted_power: a.icu_weighted_avg_watts ?? a.weighted_average_watts,
        max_power: a.max_watts ?? a.p_max,
        avg_cadence: a.average_cadence,
        avg_speed_mps: a.average_speed,
      }),
      trainer: a.trainer ?? null,
      manual: a.file_type ? false : null,
      device_name: shortText(a.device_name, 100),
    },
  };
}

/** Champs comparés pour savoir si une activité déjà reçue a changé chez intervals.icu. */
export const COMPARED_FIELDS = [
  "sport",
  "sport_detail",
  "name",
  "start_time",
  "local_date",
  "local_start_time",
  "timezone",
  "elapsed_s",
  "moving_s",
  "distance_m",
  "elevation_gain_m",
  "avg_hr",
  "max_hr",
  "avg_power",
  "weighted_power",
  "max_power",
  "avg_cadence",
  "avg_speed_mps",
  "trainer",
  "manual",
  "device_name",
] as const satisfies readonly (keyof ActivityFields)[];

/** Même contenu, aux arrondis et aux formats de la base près (nombres, instants, heures). */
export function sameActivity(stored: Record<string, unknown>, fields: ActivityFields): boolean {
  return COMPARED_FIELDS.every((key) => {
    const a = stored[key] ?? null;
    const b = fields[key] ?? null;
    if (a === null || b === null) return a === b;
    if (key === "start_time") return Date.parse(String(a)) === Date.parse(String(b));
    if (key === "local_start_time") return String(a).slice(0, 8) === String(b).slice(0, 8);
    if (typeof b === "number") return Math.abs(Number(a) - b) < 1e-6;
    return a === b;
  });
}
