/**
 * Format normalisé d'une activité réalisée, quelle que soit sa source (Strava, fichier FIT).
 * Les bornes reprennent les contraintes de la table `activities` : une valeur aberrante est
 * écartée (null) plutôt que de bloquer l'enregistrement de toute l'activité.
 */
import { z } from "zod";

export const ACTIVITY_SPORTS = ["swim", "bike", "run", "strength", "other"] as const;
export type ActivitySport = (typeof ACTIVITY_SPORTS)[number];
export type ActivitySource = "strava" | "fit_upload";

export interface ActivityFields {
  external_id: string;
  group_key: string | null;
  sport: ActivitySport;
  sport_detail: string | null;
  name: string | null;
  /** Instant de départ, ISO 8601 en UTC. */
  start_time: string;
  /** Date et heure locales de l'athlète au départ. */
  local_date: string;
  local_start_time: string | null;
  timezone: string | null;
  elapsed_s: number | null;
  moving_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  weighted_power: number | null;
  max_power: number | null;
  avg_cadence: number | null;
  avg_speed_mps: number | null;
  trainer: boolean | null;
  manual: boolean | null;
  device_name: string | null;
}

/** Entier dans [min, max], sinon null. */
export function boundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

/** Décimal arrondi à `decimals` dans [min, max], sinon null. */
export function boundedDecimal(value: unknown, min: number, max: number, decimals: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded >= min && rounded <= max ? rounded : null;
}

export function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Valeurs mesurées, bornées comme en base. */
export function metrics(input: {
  elapsed_s?: unknown;
  moving_s?: unknown;
  distance_m?: unknown;
  elevation_gain_m?: unknown;
  avg_hr?: unknown;
  max_hr?: unknown;
  avg_power?: unknown;
  weighted_power?: unknown;
  max_power?: unknown;
  avg_cadence?: unknown;
  avg_speed_mps?: unknown;
}) {
  return {
    elapsed_s: boundedInt(input.elapsed_s, 0, 172_800),
    moving_s: boundedInt(input.moving_s, 0, 172_800),
    distance_m: boundedDecimal(input.distance_m, 0, 2_000_000, 1),
    elevation_gain_m: boundedDecimal(input.elevation_gain_m, 0, 99_999, 1),
    avg_hr: boundedInt(input.avg_hr, 20, 260),
    max_hr: boundedInt(input.max_hr, 20, 260),
    avg_power: boundedInt(input.avg_power, 0, 3000),
    weighted_power: boundedInt(input.weighted_power, 0, 3000),
    max_power: boundedInt(input.max_power, 0, 4000),
    avg_cadence: boundedInt(input.avg_cadence, 0, 300),
    avg_speed_mps: boundedDecimal(input.avg_speed_mps, 0, 999, 3),
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const optionalInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
const optionalNumber = (min: number, max: number) => z.number().min(min).max(max).nullable();

/** Activité importée depuis un fichier, contrôlée côté serveur avant enregistrement. */
export const ImportedActivitySchema = z.strictObject({
  external_id: z.string().regex(/^[0-9a-f]{64}:\d{1,2}$/, "Identifiant de fichier invalide."),
  group_key: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  sport: z.enum(ACTIVITY_SPORTS),
  sport_detail: z.string().max(60).nullable(),
  name: z.string().max(200).nullable(),
  start_time: z.iso.datetime({ offset: true }),
  /** Décalage local connu (fichier FIT) ; sinon la date locale vient du fuseau de l'athlète. */
  utc_offset_s: z.number().int().min(-14 * 3600).max(14 * 3600).nullable(),
  elapsed_s: optionalInt(0, 172_800),
  moving_s: optionalInt(0, 172_800),
  distance_m: optionalNumber(0, 2_000_000),
  elevation_gain_m: optionalNumber(0, 99_999),
  avg_hr: optionalInt(20, 260),
  max_hr: optionalInt(20, 260),
  avg_power: optionalInt(0, 3000),
  weighted_power: optionalInt(0, 3000),
  max_power: optionalInt(0, 4000),
  avg_cadence: optionalInt(0, 300),
  avg_speed_mps: optionalNumber(0, 999),
  trainer: z.boolean().nullable(),
  device_name: z.string().max(100).nullable(),
});
export type ImportedActivity = z.infer<typeof ImportedActivitySchema>;

export const ImportBatchSchema = z.array(ImportedActivitySchema).min(1, "Aucune activité à importer.").max(30, "30 activités au plus par import.");

export { isoDate as IsoDateSchema, localTime as LocalTimeSchema };
