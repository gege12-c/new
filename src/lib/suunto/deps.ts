/** Dépendances réelles de l'intégration Suunto, construites à partir de la configuration du serveur. */
import "server-only";
import { tokenEncryptionKey } from "@/lib/strava/config";
import type { SyncJob } from "@/lib/strava/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { SuuntoApi } from "./api";
import { suuntoActivityIds, suuntoSettings } from "./config";
import { handleSuuntoJob, type SuuntoDeps } from "./service";

/** null tant que l'application Suunto, la clé de chiffrement ou la clé secrète Supabase manquent. */
export function suuntoDeps(siteUrl: string): SuuntoDeps | null {
  const settings = suuntoSettings();
  const key = tokenEncryptionKey();
  const admin = createAdminClient();
  if (!settings || !key || !admin) return null;
  return {
    admin,
    api: new SuuntoApi(settings),
    key,
    settings,
    siteUrl,
    activities: suuntoActivityIds(),
    now: () => new Date(),
  };
}

/** Traitements des jobs Suunto, à passer à la file commune (`runDueJobs`). */
export function suuntoJobHandlers(deps: SuuntoDeps | null): Record<string, (job: SyncJob) => Promise<void>> {
  if (!deps) return {};
  const handle = (job: SyncJob) => handleSuuntoJob(deps, job);
  return { suunto_push: handle, suunto_remove: handle };
}
