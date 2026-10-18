/**
 * Réponses de l'API Strava v3 et évènements de webhook, validés à l'entrée.
 * Seuls les champs utilisés sont décrits ; les autres sont ignorés.
 */
import { z } from "zod";

const optionalNumber = z.number().nullish();
const optionalString = z.string().nullish();

export const TokenResponseSchema = z.object({
  token_type: optionalString,
  access_token: z.string().min(8),
  refresh_token: z.string().min(8),
  /** Expiration, en secondes depuis l'époque Unix. */
  expires_at: z.number().int(),
  expires_in: optionalNumber,
  /** Autorisations accordées, séparées par des espaces ou des virgules (depuis avril 2026). */
  scope: optionalString,
  athlete: z
    .object({
      id: z.number().int(),
      firstname: optionalString,
      lastname: optionalString,
    })
    .nullish(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const SummaryActivitySchema = z.object({
  id: z.number().int(),
  name: optionalString,
  sport_type: optionalString,
  type: optionalString,
  /** Départ en UTC (ISO 8601). */
  start_date: z.string(),
  /** Heure locale de départ, écrite comme une date UTC (« 2026-10-18T07:30:00Z »). */
  start_date_local: z.string(),
  /** « (GMT+01:00) Europe/Paris » */
  timezone: optionalString,
  utc_offset: optionalNumber,
  elapsed_time: optionalNumber,
  moving_time: optionalNumber,
  distance: optionalNumber,
  total_elevation_gain: optionalNumber,
  average_heartrate: optionalNumber,
  max_heartrate: optionalNumber,
  average_watts: optionalNumber,
  weighted_average_watts: optionalNumber,
  max_watts: optionalNumber,
  average_cadence: optionalNumber,
  average_speed: optionalNumber,
  trainer: z.boolean().nullish(),
  manual: z.boolean().nullish(),
  private: z.boolean().nullish(),
  device_name: optionalString,
});
export type SummaryActivity = z.infer<typeof SummaryActivitySchema>;

export const WebhookEventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number().int().positive(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number().int().positive(),
  subscription_id: z.number().int().positive(),
  event_time: z.number().int().positive(),
  updates: z.record(z.string(), z.unknown()).nullish(),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const PushSubscriptionSchema = z.object({
  id: z.number().int(),
  callback_url: optionalString,
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;

/** Autorisations accordées, quel que soit le séparateur. */
export function parseScopes(scope: string | null | undefined): string[] {
  return (scope ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lecture des activités possible : `activity:read` ou `activity:read_all`. */
export function canReadActivities(scopes: string[]): boolean {
  return scopes.includes("activity:read") || scopes.includes("activity:read_all");
}
