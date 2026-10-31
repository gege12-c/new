/**
 * Configuration de l'envoi vers les montres Suunto, lue dans les variables d'environnement du
 * serveur (accès partenaire de Suunto, apizone.suunto.com). Tant qu'un élément manque, le
 * connecteur est « non configuré » : rien n'est simulé.
 */
import "server-only";
import { tokenEncryptionKey } from "@/lib/strava/config";
import { SEGMENT_SPORTS, type SegmentSport } from "@/lib/workout/schema";

export const SUUNTO_DEFAULT_API_BASE_URL = "https://cloudapi.suunto.com";
export const SUUNTO_DEFAULT_OAUTH_BASE_URL = "https://cloudapi-oauth.suunto.com/oauth";
/** Cookie du jeton anti-CSRF de la connexion Suunto (10 minutes, limité aux routes /api/suunto). */
export const SUUNTO_STATE_COOKIE = "tc_suunto_state";

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export interface SuuntoSettings {
  clientId: string;
  clientSecret: string;
  /** Clé d'abonnement de l'API (en-tête Ocp-Apim-Subscription-Key). */
  subscriptionKey: string;
  /** Nom de l'application chez Suunto : propriétaire exigé tel quel dans chaque guide. */
  appName: string;
  apiBaseUrl: string;
  oauthBaseUrl: string;
  /** Modes sportifs Suunto proposant les guides, par discipline (SUUNTO_ACTIVITIES, facultatif). */
  activities?: Partial<Record<SegmentSport, number[]>>;
}

/** « run:1,bike:2,swim:7|8 » → { run: [1], bike: [2], swim: [7, 8] } ; les entrées invalides sont ignorées. */
export function parseActivities(value: string | undefined): Partial<Record<SegmentSport, number[]>> | undefined {
  if (!value?.trim()) return undefined;
  const out: Partial<Record<SegmentSport, number[]>> = {};
  for (const part of value.split(",")) {
    const [sport, ids] = part.split(":").map((s) => s.trim());
    if (!(SEGMENT_SPORTS as readonly string[]).includes(sport) || !ids) continue;
    const list = ids
      .split("|")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id >= 0);
    if (list.length) out[sport as SegmentSport] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

export function suuntoSettings(): SuuntoSettings | null {
  const clientId = process.env.SUUNTO_CLIENT_ID?.trim();
  const clientSecret = process.env.SUUNTO_CLIENT_SECRET?.trim();
  const subscriptionKey = process.env.SUUNTO_SUBSCRIPTION_KEY?.trim();
  const appName = process.env.SUUNTO_APP_NAME?.trim();
  if (!clientId || !clientSecret || !subscriptionKey || !appName || appName.length > 64) return null;
  return {
    clientId,
    clientSecret,
    subscriptionKey,
    appName,
    apiBaseUrl: trimSlash(process.env.SUUNTO_API_BASE_URL?.trim() || SUUNTO_DEFAULT_API_BASE_URL),
    oauthBaseUrl: trimSlash(process.env.SUUNTO_OAUTH_BASE_URL?.trim() || SUUNTO_DEFAULT_OAUTH_BASE_URL),
    activities: parseActivities(process.env.SUUNTO_ACTIVITIES),
  };
}

/** Prêt : application Suunto, clé de chiffrement des jetons et clé secrète Supabase présentes. */
export function isSuuntoReady(): boolean {
  return suuntoSettings() !== null && tokenEncryptionKey() !== null && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
}
