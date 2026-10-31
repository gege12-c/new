/** Dépendances réelles des envois vers les montres, et déclenchement après un changement de séance. */
import "server-only";
import { after } from "next/server";
import { INTERVALS_DEFAULT_BASE_URL, IntervalsApi } from "@/lib/intervals/api";
import { runIntervalsJobs, type IntervalsDeps } from "@/lib/intervals/service";
import { getSiteUrl } from "@/lib/site";
import { tokenEncryptionKey } from "@/lib/strava/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { suuntoSettings } from "@/lib/suunto/config";
import { suuntoDeps } from "@/lib/suunto/deps";
import { runSuuntoJobs } from "@/lib/suunto/service";

/** Relais intervals.icu : prêt dès que la clé de chiffrement et la clé secrète Supabase sont là. */
export function intervalsDeps(): IntervalsDeps | null {
  const key = tokenEncryptionKey();
  const admin = createAdminClient();
  if (!key || !admin) return null;
  const baseUrl = (process.env.INTERVALS_API_BASE_URL?.trim() || INTERVALS_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { admin, api: new IntervalsApi(baseUrl), key, now: () => new Date() };
}


/**
 * Après un changement de séance ou de seuils : les envois mis en file par la base partent aussitôt,
 * une fois la réponse rendue (relais intervals.icu, et Suunto en direct s'il est configuré).
 */
export async function kickDeviceSync(): Promise<void> {
  const intervals = intervalsDeps();
  const suunto = suuntoSettings() ? suuntoDeps(await getSiteUrl()) : null;
  if (!intervals && !suunto) return;
  after(async () => {
    if (intervals) await runIntervalsJobs(intervals, { limit: 5, budgetMs: 20_000 }).catch(() => undefined);
    if (suunto) await runSuuntoJobs(suunto, { limit: 5, budgetMs: 20_000 }).catch(() => undefined);
  });
}
