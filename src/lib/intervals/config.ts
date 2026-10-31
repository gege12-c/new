/**
 * Relais intervals.icu : disponible dès que les clés du serveur sont là (chaque athlète apporte sa
 * clé API) ; la connexion par « Autoriser » (OAuth) demande en plus l'application TriCoach
 * enregistrée chez intervals.icu (identifiant et secret dans la configuration du site).
 */
import "server-only";
import { tokenEncryptionKey } from "@/lib/strava/config";

export function isIntervalsReady(): boolean {
  return tokenEncryptionKey() !== null && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Autorisations demandées à l'athlète (documentation OAuth d'intervals.icu) : lire ses activités et
 * ses mesures du matin, écrire dans son calendrier (séances), lire et mettre à jour ses seuils.
 */
export const INTERVALS_OAUTH_SCOPES = "ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE,SETTINGS:WRITE";

export function intervalsOAuthSettings(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.INTERVALS_CLIENT_ID?.trim();
  const clientSecret = process.env.INTERVALS_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isIntervalsOAuthReady(): boolean {
  return isIntervalsReady() && intervalsOAuthSettings() !== null;
}

export function intervalsBaseUrl(): string {
  return (process.env.INTERVALS_API_BASE_URL?.trim() || "https://intervals.icu").replace(/\/+$/, "");
}
