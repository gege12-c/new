import { Link2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { getDetailsProgress, type DetailsProgress } from "@/lib/data/activities";
import { getDeviceAccounts, type DeviceAccount, type DeviceLastError } from "@/lib/data/devices";
import { isIntervalsOAuthReady, isIntervalsReady } from "@/lib/intervals/config";
import { isSuuntoReady } from "@/lib/suunto/config";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { todayIn } from "@/lib/time";
import { IntervalsKeyForm, WatchSyncControls } from "./watch-sync-controls";
import { IntervalsThresholds } from "./intervals-thresholds";

/** Retour de la connexion Suunto (paramètre ?suunto= posé par /api/suunto/callback). */
const SUUNTO_CALLBACK: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Suunto est relié : vos séances des 7 prochains jours partent sur votre compte Suunto dans quelques instants." },
  denied: { tone: "warning", text: "Connexion annulée : vous n’avez pas autorisé TriCoach chez Suunto." },
  already_linked: { tone: "error", text: "Ce compte Suunto est déjà relié à un autre compte TriCoach. Déliez-le d’abord de cet autre compte." },
  invalid_state: { tone: "error", text: "La connexion a expiré ou n’a pas été lancée depuis cette page : réessayez." },
  not_configured: { tone: "warning", text: "L’envoi direct vers Suunto n’est pas encore configuré sur ce site." },
  error: { tone: "error", text: "Suunto n’a pas répondu comme prévu : rien n’a été enregistré. Réessayez dans quelques minutes." },
};

const INTERVALS_CALLBACK: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: { tone: "success", text: "intervals.icu est relié : vos séances publiées des 14 prochains jours y partent maintenant." },
  denied: { tone: "warning", text: "Connexion annulée : TriCoach n’a pas été autorisé chez intervals.icu. Rien n’a été relié." },
  already_linked: { tone: "error", text: "Ce compte intervals.icu est déjà relié à un autre compte TriCoach. Déliez-le d’abord de cet autre compte." },
  invalid_state: { tone: "error", text: "La connexion a expiré ou n’a pas été lancée depuis cette page : touchez de nouveau « Relier intervals.icu »." },
  not_configured: { tone: "warning", text: "La connexion par « Autoriser » n’est pas encore configurée sur ce site : utilisez la clé API." },
  unreachable: { tone: "error", text: "intervals.icu ne répond pas pour l’instant : rien n’a été enregistré. Réessayez dans quelques minutes." },
  error: { tone: "error", text: "intervals.icu n’a pas répondu comme prévu : rien n’a été enregistré. Réessayez dans quelques minutes." },
};

const ERRORS: Record<Exclude<DeviceLastError, null | "reauth_required">, string> = {
  sync_failed: "Le dernier envoi a échoué : TriCoach réessaie automatiquement.",
  not_permitted: "Suunto refuse pour l’instant l’envoi direct (accès partenaire à finaliser) : vos séances partiront dès que ce sera réglé.",
  app_name_mismatch: "Suunto refuse les séances de TriCoach (réglage du site à corriger) : elles partiront dès que ce sera réglé.",
};

const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

function AccountState({ account, where, timeZone, details }: { account: DeviceAccount; where: string; timeZone: string; details?: DetailsProgress | null }) {
  return (
    <>
      <div className="text-[13.5px] text-ink-soft">
        <p>
          Relié au compte <span className="font-semibold text-ink">{account.account}</span> depuis le {when(account.connectedAt, timeZone)}.
        </p>
        <p className="mt-1">
          {account.lastSyncAt ? (
            <>
              Dernier envoi le {when(account.lastSyncAt, timeZone)} : <span className="figure font-semibold text-ink">{account.sent}</span> séance
              {account.sent > 1 ? "s" : ""} {where}
              {account.failed ? (
                <span className="text-warning">
                  , {account.failed} non envoyée{account.failed > 1 ? "s" : ""} (raison dans la séance)
                </span>
              ) : null}
              .
            </>
          ) : (
            "Premier envoi en cours."
          )}
        </p>
      </div>
      {account.lastError && account.lastError !== "reauth_required" ? <Notice tone="warning">{ERRORS[account.lastError]}</Notice> : null}
      {account.activities ? <ActivitiesState activities={account.activities} timeZone={timeZone} details={details ?? null} /> : null}
    </>
  );
}

/** Détails (courbes, puissance, intervalles) des activités de l'année : lus, ou en cours de lecture. */
function DetailsState({ details }: { details: DetailsProgress }) {
  if (!details.total) return null;
  if (details.done >= details.total) {
    return (
      <p>
        Détails (courbes, puissance, intervalles) : lus pour {details.total > 1 ? `vos ${details.total} activités` : "votre activité"} de l’année.
      </p>
    );
  }
  return (
    <p>
      Détails (courbes, puissance, intervalles) : <span className="figure font-semibold text-ink">{details.done}</span> activité{details.done > 1 ? "s" : ""} sur{" "}
      <span className="figure">{details.total}</span> de l’année. Les autres se lisent pendant que TriCoach est ouvert, les plus récentes et le vélo d’abord.
    </p>
  );
}

/** Retour des activités faites avec la montre, par intervals.icu. */
function ActivitiesState({ activities, timeZone, details }: { activities: NonNullable<DeviceAccount["activities"]>; timeZone: string; details: DetailsProgress | null }) {
  return (
    <div className="space-y-2 text-[13.5px] text-ink-soft">
      <p>
        {activities.syncedAt ? (
          <>
            Activités faites : <span className="figure font-semibold text-ink">{activities.count}</span> reçue{activities.count > 1 ? "s" : ""} de votre montre par
            intervals.icu (dernière réception le {when(activities.syncedAt, timeZone)}). Elles sont rattachées à vos séances et comptent dans votre progression ; vos
            mesures du matin (FC au repos, VFC, sommeil, poids), si votre montre les transmet, complètent votre forme du jour sans remplacer ce que vous saisissez.
          </>
        ) : (
          "Activités faites : première réception en cours (la dernière année)."
        )}
      </p>
      {activities.syncedAt && details ? <DetailsState details={details} /> : null}
      {activities.fromStrava ? (
        <Notice tone="warning">
          {activities.fromStrava > 1
            ? `${activities.fromStrava} activités récentes viennent de Strava chez intervals.icu, qui ne les transmet pas.`
            : "Une activité récente vient de Strava chez intervals.icu, qui ne la transmet pas."}{" "}
          Pour les recevoir ici, reliez votre montre directement à intervals.icu (Settings), ou connectez Strava à TriCoach.
        </Notice>
      ) : null}
    </div>
  );
}

/**
 * Séances sur la montre : par intervals.icu (relais officiel vers Suunto, Garmin et COROS, et vers Wahoo), ou
 * directement chez Suunto dès que l'accès partenaire de TriCoach est ouvert.
 */
export async function WatchSyncPanel({
  supabase,
  userId,
  timeZone,
  suuntoCallback,
  intervalsCallback,
}: {
  supabase: ServerSupabase;
  userId: string;
  timeZone: string;
  suuntoCallback?: string;
  intervalsCallback?: string;
}) {
  const [accounts, details] = await Promise.all([getDeviceAccounts(supabase, userId), todayIn(timeZone).then((today) => getDetailsProgress(supabase, userId, today))]);
  const intervalsReady = isIntervalsReady();
  const suuntoReady = isSuuntoReady();
  const oauthReady = isIntervalsOAuthReady();
  const notice = suuntoCallback ? SUUNTO_CALLBACK[suuntoCallback] : intervalsCallback ? INTERVALS_CALLBACK[intervalsCallback] : undefined;

  return (
    <Panel
      id="montre-auto"
      title="Séances sur la montre"
      description="Vos séances publiées partent seules sur votre montre, avec l’écran de chaque étape, sa cible et son compte à rebours. Une séance modifiée ou annulée est mise à jour ou retirée."
      className="scroll-mt-20 lg:scroll-mt-6"
    >
      {accounts === "schema_pending" ? (
        <p className="text-[14px] text-muted">{SCHEMA_PENDING_MESSAGE}</p>
      ) : (
        <div className="space-y-6">
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

          <section aria-labelledby="intervals-title" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="intervals-title" className="text-[15px] font-semibold">
                Suunto, Garmin, COROS, Wahoo, par intervals.icu
              </h3>
              <span className={accounts.intervals?.status === "active" ? "text-[12.5px] font-semibold text-success" : "text-[12.5px] text-muted"}>
                {accounts.intervals
                  ? accounts.intervals.status === "active"
                    ? "Relié"
                    : accounts.intervals.authorized
                      ? "Autorisation à renouveler"
                      : "Clé à renouveler"
                  : intervalsReady
                    ? "Non relié"
                    : "Non configuré"}
              </span>
            </div>
            {!intervalsReady ? (
              <p className="text-[13.5px] text-muted">Pas encore disponible sur ce site : il manque la clé de chiffrement des comptes reliés.</p>
            ) : accounts.intervals?.status === "active" ? (
              <>
                <AccountState account={accounts.intervals} where="dans votre calendrier intervals.icu" timeZone={timeZone} details={details} />
                <WatchSyncControls provider="intervals" />
                <IntervalsThresholds />
              </>
            ) : oauthReady ? (
              <>
                {accounts.intervals ? (
                  <Notice tone="warning">
                    intervals.icu refuse l’accès enregistré (autorisation retirée ou clé changée) : autorisez TriCoach de nouveau pour que vos séances repartent.
                  </Notice>
                ) : (
                  <p className="text-[13.5px] text-ink-soft">
                    intervals.icu, partenaire officiel de Suunto, Garmin et COROS, transmet à votre montre (ou à votre compteur Wahoo) les séances que TriCoach dépose dans son calendrier, et
                    renvoie à TriCoach les activités faites avec la montre. Gratuit, à faire une fois :
                  </p>
                )}
                <ol className="list-decimal space-y-1 pl-5 text-[13.5px] text-ink-soft">
                  <li>
                    Créez un compte sur{" "}
                    <a className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href="https://intervals.icu" target="_blank" rel="noreferrer">
                      intervals.icu
                    </a>{" "}
                    ; dans ses réglages (Settings), reliez votre montre ou votre compteur et cochez l’envoi des séances prévues.
                  </li>
                  <li>Touchez « Relier intervals.icu », puis « Autoriser » chez intervals.icu : vous revenez ici, relié.</li>
                </ol>
                <a href="/api/intervals/connect" className={buttonClasses("primary", "sm")}>
                  <Link2 aria-hidden />
                  {accounts.intervals ? "Autoriser de nouveau" : "Relier intervals.icu"}
                </a>
                <details className="pt-1">
                  <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">Ou avec une clé API</summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-[13px] text-muted">intervals.icu, Settings, en bas, « Developer Settings » : copiez la clé API et collez-la ci-dessous.</p>
                    <IntervalsKeyForm again={Boolean(accounts.intervals)} />
                  </div>
                </details>
              </>
            ) : (
              <>
                {accounts.intervals ? (
                  <Notice tone="warning">intervals.icu refuse la clé enregistrée (changée ou supprimée) : collez votre nouvelle clé pour que vos séances repartent.</Notice>
                ) : (
                  <p className="text-[13.5px] text-ink-soft">
                    intervals.icu, partenaire officiel de Suunto, Garmin et COROS, transmet à votre montre (ou à votre compteur Wahoo) les séances que TriCoach dépose dans son calendrier, et
                    renvoie à TriCoach les activités faites avec la montre. Gratuit, à faire une fois :
                  </p>
                )}
                <ol className="list-decimal space-y-1 pl-5 text-[13.5px] text-ink-soft">
                  <li>
                    Créez un compte sur{" "}
                    <a className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href="https://intervals.icu" target="_blank" rel="noreferrer">
                      intervals.icu
                    </a>
                    .
                  </li>
                  <li>Dans ses réglages (Settings), reliez votre montre ou votre compteur (Suunto, Garmin, COROS ou Wahoo) et cochez l’envoi des séances prévues (« Upload planned workouts », « Upload workouts » pour Wahoo).</li>
                  <li>Toujours dans Settings, en bas, « Developer Settings » : copiez la clé API et collez-la ci-dessous.</li>
                </ol>
                <IntervalsKeyForm again={Boolean(accounts.intervals)} />
              </>
            )}
          </section>

          <section aria-labelledby="suunto-title" id="suunto" className="scroll-mt-20 space-y-3 border-t border-line pt-5 lg:scroll-mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="suunto-title" className="text-[15px] font-semibold">
                Suunto en direct
              </h3>
              <span className={accounts.suunto?.status === "active" ? "text-[12.5px] font-semibold text-success" : "text-[12.5px] text-muted"}>
                {accounts.suunto ? (accounts.suunto.status === "active" ? "Relié" : "Reconnexion nécessaire") : suuntoReady ? "Non relié" : "Bientôt"}
              </span>
            </div>
            {!suuntoReady ? (
              <p className="text-[13.5px] text-muted">
                Sans intermédiaire, dès que Suunto aura ouvert son accès partenaire à TriCoach (demande en cours). Inutile si votre Suunto passe déjà par intervals.icu.
              </p>
            ) : !accounts.suunto ? (
              <>
                <p className="text-[13.5px] text-ink-soft">
                  Reliez votre compte Suunto : vos séances des 7 prochains jours y partent comme guides SuuntoPlus. Si votre Suunto est déjà reliée à intervals.icu, choisissez
                  l’une des deux voies, sinon chaque séance arrivera deux fois.
                </p>
                <a href="/api/suunto/connect" className={buttonClasses("primary", "sm")}>
                  <Link2 aria-hidden />
                  Connecter mon compte Suunto
                </a>
              </>
            ) : accounts.suunto.status === "reauth_required" ? (
              <>
                <Notice tone="warning">Suunto a refusé l’accès de TriCoach (autorisation retirée ou expirée) : reconnectez votre compte pour que vos séances repartent.</Notice>
                <a href="/api/suunto/connect" className={buttonClasses("primary", "sm")}>
                  <Link2 aria-hidden />
                  Reconnecter Suunto
                </a>
              </>
            ) : (
              <>
                <AccountState account={accounts.suunto} where="sur votre compte Suunto" timeZone={timeZone} />
                <WatchSyncControls provider="suunto" />
              </>
            )}
          </section>

          <ul className="space-y-1 border-t border-line pt-3 text-[12.5px] leading-snug text-muted">
            <li>La montre reçoit les séances à sa synchronisation avec l’application de la marque (Suunto, Garmin Connect, COROS, Wahoo ELEMNT) ; ouvrez-la si besoin.</li>
            <li>
              Suunto : au lancement du sport, choisissez la séance parmi les guides SuuntoPlus. Garmin, COROS et Wahoo : la séance du jour est dans le calendrier ou les séances
              planifiées de l’appareil (le menu varie selon le modèle).
            </li>
            <li>
              TriCoach n’envoie que vos séances publiées, cibles comprises. Une même activité reçue par Strava et par intervals.icu n’est comptée qu’une fois.
            </li>
          </ul>
        </div>
      )}
    </Panel>
  );
}
