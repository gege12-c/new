/** Conversion d'une activité Strava vers le format normalisé de l'application. */
import { metrics, shortText, type ActivityFields, type ActivitySport } from "@/lib/activities/schema";
import type { SummaryActivity } from "./schemas";

const BIKE = new Set(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);
const RUN = new Set(["Run", "TrailRun", "VirtualRun"]);
const SWIM = new Set(["Swim"]);
const STRENGTH = new Set(["WeightTraining", "Crossfit", "Workout", "HighIntensityIntervalTraining"]);

export function stravaSport(sportType: string | null | undefined, legacyType?: string | null): ActivitySport {
  const type = sportType || legacyType || "";
  if (BIKE.has(type)) return "bike";
  if (RUN.has(type)) return "run";
  if (SWIM.has(type)) return "swim";
  if (STRENGTH.has(type)) return "strength";
  return "other";
}

/** « (GMT+01:00) Europe/Paris » → « Europe/Paris » (si le fuseau est reconnu). */
export function stravaTimeZone(value: string | null | undefined): string | null {
  const name = value?.split(") ").pop()?.trim();
  if (!name || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(name)) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return name.slice(0, 64);
  } catch {
    return null;
  }
}

/** Champs normalisés (le serveur ajoute la connexion, la lecture et l'effacement programmé). */
export function normalizeStravaActivity(activity: SummaryActivity): ActivityFields {
  const local = activity.start_date_local;
  const start = new Date(activity.start_date);
  if (Number.isNaN(start.getTime()) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(local)) {
    throw new Error("Date d'activité Strava illisible.");
  }
  return {
    external_id: String(activity.id),
    group_key: null,
    sport: stravaSport(activity.sport_type, activity.type),
    sport_detail: shortText(activity.sport_type ?? activity.type, 60),
    name: shortText(activity.name, 200),
    start_time: start.toISOString(),
    local_date: local.slice(0, 10),
    local_start_time: local.slice(11, 19),
    timezone: stravaTimeZone(activity.timezone),
    ...metrics({
      elapsed_s: activity.elapsed_time,
      moving_s: activity.moving_time,
      distance_m: activity.distance,
      elevation_gain_m: activity.total_elevation_gain,
      avg_hr: activity.average_heartrate,
      max_hr: activity.max_heartrate,
      avg_power: activity.average_watts,
      weighted_power: activity.weighted_average_watts,
      max_power: activity.max_watts,
      avg_cadence: activity.average_cadence,
      avg_speed_mps: activity.average_speed,
    }),
    trainer: activity.trainer ?? null,
    manual: activity.manual ?? null,
    device_name: shortText(activity.device_name, 100),
  };
}
