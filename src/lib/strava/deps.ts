/** Dépendances réelles de l'intégration Strava, construites à partir de la configuration du serveur. */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { stravaSettings, tokenEncryptionKey } from "./config";
import { makeStravaApi, type StravaDeps } from "./service";

/** null tant que l'application Strava, la clé de chiffrement ou la clé secrète Supabase manquent. */
export function stravaDeps(): StravaDeps | null {
  const settings = stravaSettings();
  const key = tokenEncryptionKey();
  const admin = createAdminClient();
  if (!settings || !key || !admin) return null;
  return { admin, api: makeStravaApi(settings, admin), key, settings, now: () => new Date() };
}
