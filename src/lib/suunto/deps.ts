/** Dépendances réelles de l'envoi vers Suunto, construites à partir de la configuration du serveur. */
import "server-only";
import { tokenEncryptionKey } from "@/lib/strava/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { suuntoSettings } from "./config";
import { makeSuuntoApi, type SuuntoDeps } from "./service";

/** null tant que l'accès partenaire Suunto, la clé de chiffrement ou la clé secrète Supabase manquent. */
export function suuntoDeps(siteUrl: string): SuuntoDeps | null {
  const settings = suuntoSettings();
  const key = tokenEncryptionKey();
  const admin = createAdminClient();
  if (!settings || !key || !admin) return null;
  return {
    admin,
    api: makeSuuntoApi(settings),
    key,
    settings,
    siteUrl,
    now: () => new Date(),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeGapMs: 1000,
  };
}
