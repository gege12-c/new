/** Relais intervals.icu : disponible dès que les clés du serveur sont là (chaque athlète apporte sa clé API). */
import "server-only";
import { tokenEncryptionKey } from "@/lib/strava/config";

export function isIntervalsReady(): boolean {
  return tokenEncryptionKey() !== null && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
}
