"use client";

import { useActionState } from "react";
import { setStravaSharing } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

/**
 * Autorisation expresse, donnée par l'athlète à l'un de ses coachs, de voir ses activités Strava
 * (politique API de Strava, §5.13) : désactivée par défaut, retirée d'un geste, à redonner si la
 * relation est retirée puis rétablie.
 */
export function StravaSharingForm({
  linkId,
  coachName,
  sharedAt,
  timeZone,
}: {
  linkId: string;
  coachName: string;
  sharedAt: string | null;
  timeZone: string;
}) {
  const [state, action] = useActionState(setStravaSharing, idle);
  const shared = sharedAt !== null;
  const since = shared ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone }).format(new Date(sharedAt)) : null;
  return (
    <form action={action} className="space-y-2.5 rounded-[12px] border border-line p-3">
      <input type="hidden" name="link_id" value={linkId} />
      <input type="hidden" name="share" value={shared ? "off" : "on"} />
      <p className="text-[14px] font-semibold">Activités Strava</p>
      <p className="text-[13.5px] text-ink-soft">
        {shared ? `${coachName} voit vos activités Strava depuis le ${since}.` : `${coachName} ne voit pas vos activités Strava.`}
      </p>
      <p className="text-[12.5px] leading-snug text-muted">
        Partagées, chacune lui montre votre activité (durée, distance, allure, fréquence cardiaque, puissance) et sa comparaison avec la séance prévue, pendant
        les 6 jours où TriCoach la garde. Elles n’entrent dans aucune statistique (règles de Strava). Vous pouvez arrêter le partage à tout moment.
      </p>
      <FormMessage state={state} />
      {/* Le nom du coach peut être long : le libellé passe à la ligne au lieu de déborder sur téléphone. */}
      <SubmitButton size="sm" variant={shared ? "secondary" : "primary"} pendingLabel="Enregistrement…" className="h-auto min-h-8 whitespace-normal py-1.5 text-left">
        {shared ? "Arrêter le partage" : `Autoriser ${coachName} à voir mes activités Strava`}
      </SubmitButton>
    </form>
  );
}
