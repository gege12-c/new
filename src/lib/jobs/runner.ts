/** File de jobs commune (Strava, Suunto, maintenance), construite d'après la configuration du serveur. */
import "server-only";
import { stravaDeps } from "@/lib/strava/deps";
import { stravaJobHandlers, type JobRunner } from "@/lib/strava/service";
import { suuntoDeps, suuntoJobHandlers } from "@/lib/suunto/deps";

/** null tant qu'aucune intégration n'est configurée (ni Strava ni Suunto). */
export function jobRunner(siteUrl: string): JobRunner | null {
  const strava = stravaDeps();
  const suunto = suuntoDeps(siteUrl);
  const admin = strava?.admin ?? suunto?.admin;
  if (!admin) return null;
  return {
    admin,
    now: () => new Date(),
    handlers: {
      ...(strava ? stravaJobHandlers(strava) : {}),
      ...suuntoJobHandlers(suunto),
    },
  };
}
