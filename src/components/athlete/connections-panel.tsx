import { Link2 } from "lucide-react";
import { SPORT_ICONS } from "@/components/sport";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { activityDuration } from "@/lib/activities/compare";
import { activityTitle } from "@/lib/activities/labels";
import type { ActivitySport } from "@/lib/activities/schema";
import { formatDayMonth } from "@/lib/planning/dates";
import { isStravaReady } from "@/lib/strava/config";
import type { ServerSupabase } from "@/lib/supabase/server";
import { formatDurationShort } from "@/lib/workout/format";
import { DeleteImportedButton } from "@/components/activities/realization-actions";
import { FitImport } from "./fit-import";
import { StravaControls } from "./strava-controls";

/** Retour de la connexion Strava (paramètre ?strava= posé par /api/strava/callback). */
const CALLBACK_MESSAGES: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Strava est connecté : vos activités des 7 derniers jours arrivent dans quelques instants." },
  denied: { tone: "warning", text: "Connexion annulée : vous n’avez pas autorisé TriCoach sur Strava." },
  missing_scope: {
    tone: "warning",
    text: "Connexion refusée : cochez l’accès à vos activités (y compris privées) sur la page d’autorisation de Strava, sinon TriCoach ne peut rien recevoir.",
  },
  already_linked: { tone: "error", text: "Ce compte Strava est déjà relié à un autre compte TriCoach. Déconnectez-le d’abord de cet autre compte." },
  invalid_state: { tone: "error", text: "La connexion a expiré ou n’a pas été lancée depuis cette page : réessayez." },
  not_configured: { tone: "warning", text: "La connexion Strava n’est pas encore configurée sur ce site." },
  error: { tone: "error", text: "Strava n’a pas répondu comme prévu : rien n’a été enregistré. Réessayez dans quelques minutes." },
};

const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

export async function ConnectionsPanel({ supabase, timeZone, callbackStatus }: { supabase: ServerSupabase; timeZone: string; callbackStatus?: string }) {
  const [connectionResult, importsResult] = await Promise.all([
    supabase.from("external_connections").select("status, connected_at, last_sync_at, last_error").eq("provider", "strava").maybeSingle(),
    supabase
      .from("activities")
      .select("id, sport, name, local_date, elapsed_s, moving_s, created_at")
      .eq("source", "fit_upload")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  if (connectionResult.error) throw connectionResult.error;
  if (importsResult.error) throw importsResult.error;
  const connection = connectionResult.data;
  const imports = importsResult.data ?? [];
  const ready = isStravaReady();
  const notice = callbackStatus ? CALLBACK_MESSAGES[callbackStatus] : undefined;

  return (
    <Panel
      id="connexions"
      title="Activités réalisées"
      description="Elles sont rapprochées de vos séances pour comparer le prévu et le réalisé."
      className="scroll-mt-20 lg:scroll-mt-6"
    >
      <div className="space-y-6">
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

        <section aria-labelledby="strava-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="strava-title" className="text-[15px] font-semibold">
              Strava
            </h3>
            {connection ? (
              <span className={connection.status === "active" ? "text-[12.5px] font-semibold text-success" : "text-[12.5px] font-semibold text-warning"}>
                {connection.status === "active" ? "Connecté" : "Reconnexion nécessaire"}
              </span>
            ) : (
              <span className="text-[12.5px] text-muted">{ready ? "Non connecté" : "Non configuré"}</span>
            )}
          </div>

          {!ready ? (
            <p className="text-[13.5px] text-muted">
              La connexion Strava n’est pas encore configurée sur ce site. En attendant, importez vos fichiers FIT ci-dessous.
            </p>
          ) : connection ? (
            <>
              {connection.status === "reauth_required" ? (
                <Notice tone="warning">Strava a refusé l’accès de TriCoach (autorisation retirée ou expirée) : reconnectez votre compte pour recevoir vos activités.</Notice>
              ) : null}
              <p className="text-[13.5px] text-ink-soft">
                {connection.last_sync_at ? `Dernière synchronisation le ${when(connection.last_sync_at, timeZone)}. ` : "Première synchronisation en cours. "}
                Chaque activité arrive en quelques minutes.
                {connection.last_error === "sync_failed" ? " La dernière synchronisation a échoué : TriCoach réessaie automatiquement." : ""}
              </p>
              {connection.status === "reauth_required" ? (
                <a href="/api/strava/connect" className={buttonClasses("primary", "sm")}>
                  <Link2 aria-hidden />
                  Reconnecter Strava
                </a>
              ) : (
                <StravaControls />
              )}
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-ink-soft">
                Reliez votre compte pour que vos activités arrivent seules et soient rapprochées de vos séances. TriCoach demande seulement à lire vos activités.
              </p>
              <a href="/api/strava/connect" className={buttonClasses("primary", "sm")}>
                <Link2 aria-hidden />
                Connecter Strava
              </a>
            </>
          )}
          <ul className="space-y-1 text-[12.5px] leading-snug text-muted">
            <li>Vos données Strava ne sont visibles que de vous : votre coach voit vos retours de séance et vos fichiers FIT, pas vos activités Strava (règles de Strava).</li>
            <li>TriCoach les efface au bout de 6 jours (Strava interdit de les garder plus de 7 jours) ; vos retours de séance, eux, restent.</li>
            <li>Déconnecter Strava efface aussitôt toutes vos données Strava de TriCoach.</li>
          </ul>
        </section>

        <section aria-labelledby="fit-title" className="space-y-3 border-t border-line pt-5">
          <div>
            <h3 id="fit-title" className="text-[15px] font-semibold">
              Fichiers FIT
            </h3>
            <p className="mt-0.5 text-[13.5px] text-ink-soft">
              Le fichier d’origine de votre montre ou compteur : dans Garmin Connect, ouvrez l’activité puis « Exporter le fichier d’origine ». Votre coach voit
              ces activités si vous l’y autorisez, et elles sont conservées.
            </p>
          </div>
          <FitImport />
          {imports.length ? (
            <div>
              <p className="text-[12.5px] font-semibold text-muted">Derniers imports</p>
              <ul className="mt-1 divide-y divide-line">
                {imports.map((activity) => {
                  const Icon = SPORT_ICONS[activity.sport as ActivitySport];
                  const duration = activityDuration({ sport: activity.sport as ActivitySport, moving_s: activity.moving_s, elapsed_s: activity.elapsed_s });
                  return (
                    <li key={activity.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 text-[13.5px]">
                        <span className="font-medium">{activityTitle({ name: activity.name, sport: activity.sport as ActivitySport })}</span>
                        <span className="figure text-muted">
                          , {formatDayMonth(activity.local_date)}
                          {duration ? `, ${formatDurationShort(duration)}` : ""}
                        </span>
                      </span>
                      <DeleteImportedButton activityId={activity.id} compact />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </Panel>
  );
}
