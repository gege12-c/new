import { Link2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { getSuuntoConnection } from "@/lib/data/suunto";
import { isSuuntoReady, SUUNTO_WINDOW_DAYS } from "@/lib/suunto/config";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { SuuntoControls } from "./suunto-controls";

/** Retour de la connexion Suunto (paramètre ?suunto= posé par /api/suunto/callback). */
const CALLBACK_MESSAGES: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: {
    tone: "success",
    text: "Suunto est connecté : vos séances des 14 prochains jours partent sur votre compte Suunto dans quelques instants. Ouvrez ensuite l’appli Suunto sur votre téléphone pour les passer sur la montre.",
  },
  denied: {
    tone: "warning",
    text: "Connexion annulée : vous n’avez pas autorisé TriCoach sur Suunto.",
  },
  disconnected: {
    tone: "success",
    text: "Compte Suunto déconnecté : les séances envoyées ont été retirées de votre compte Suunto.",
  },
  disconnected_partial: {
    tone: "warning",
    text: "Compte Suunto déconnecté. Certaines séances n’ont pas pu être retirées de votre compte Suunto : supprimez-les dans l’appli Suunto (SuuntoPlus, Guides).",
  },
  already_linked: {
    tone: "error",
    text: "Ce compte Suunto est déjà relié à un autre compte TriCoach. Déconnectez-le d’abord de cet autre compte.",
  },
  invalid_state: {
    tone: "error",
    text: "La connexion a expiré ou n’a pas été lancée depuis cette page : réessayez.",
  },
  not_configured: {
    tone: "warning",
    text: "L’envoi vers Suunto n’est pas encore configuré sur ce site.",
  },
  error: {
    tone: "error",
    text: "Suunto n’a pas répondu comme prévu : rien n’a été enregistré. Réessayez dans quelques minutes.",
  },
};

const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));

/** Compte Suunto de l'athlète : connexion, état des envois, déconnexion. */
export async function SuuntoPanel({
  supabase,
  athleteId,
  timeZone,
  callbackStatus,
}: {
  supabase: ServerSupabase;
  athleteId: string;
  timeZone: string;
  callbackStatus?: string;
}) {
  const connection = await getSuuntoConnection(supabase, athleteId);
  const ready = isSuuntoReady();
  const notice = callbackStatus ? CALLBACK_MESSAGES[callbackStatus] : undefined;

  return (
    <Panel
      id="montre-suunto"
      title="Montre Suunto"
      description={`Reliez votre compte Suunto : chaque séance publiée des ${SUUNTO_WINDOW_DAYS} prochains jours arrive sur votre montre comme guide SuuntoPlus (étapes, cibles, compte à rebours), mise à jour si le coach la modifie, retirée si elle est annulée.`}
      className="scroll-mt-20 lg:scroll-mt-6"
    >
      <div className="space-y-4">
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        {connection === "schema_pending" ? (
          <p className="text-[14px] text-muted">{SCHEMA_PENDING_MESSAGE}</p>
        ) : !ready ? (
          <p className="text-[13.5px] text-muted">
            L’envoi vers Suunto n’est pas encore configuré sur ce site. En attendant, chaque séance propose sa fiche « étapes Suunto » à recopier dans l’appli.
          </p>
        ) : connection ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13.5px] text-ink-soft">
                {connection.status === "active" ? `Connecté le ${when(connection.connected_at, timeZone)}` : "Reconnexion nécessaire"}
                {connection.last_sync_at ? `, dernier envoi le ${when(connection.last_sync_at, timeZone)}` : ""}.
              </p>
              <span className={connection.status === "active" ? "text-[12.5px] font-semibold text-success" : "text-[12.5px] font-semibold text-warning"}>
                {connection.status === "active" ? "Connecté" : "Reconnexion nécessaire"}
              </span>
            </div>
            {connection.status === "reauth_required" ? (
              <>
                <Notice tone="warning">
                  Suunto a refusé l’accès de TriCoach (autorisation retirée ou expirée) : reconnectez votre compte pour que vos séances repartent sur la montre.
                </Notice>
                <a href="/api/suunto/connect" className={buttonClasses("primary", "sm")}>
                  <Link2 aria-hidden />
                  Reconnecter Suunto
                </a>
              </>
            ) : connection.last_error === "push_failed" ? (
              <Notice tone="warning">Le dernier envoi a échoué : TriCoach réessaie automatiquement. Le détail est dans la fiche de la séance.</Notice>
            ) : null}
            {connection.status === "active" ? <SuuntoControls /> : null}
          </>
        ) : (
          <a href="/api/suunto/connect" className={buttonClasses("primary", "sm")}>
            <Link2 aria-hidden />
            Connecter mon compte Suunto
          </a>
        )}
        <ul className="space-y-1 text-[12.5px] leading-snug text-muted">
          <li>
            Sur la montre : lancez le sport, la séance du jour est proposée ; sinon Options, SuuntoPlus, Guides. Un appui sur le bouton tour saute une étape «
            bouton tour ».
          </li>
          <li>
            La montre reçoit les guides par l’appli Suunto de votre téléphone, à sa synchronisation habituelle : ouvrez-la après une modification du coach.
          </li>
          <li>Déconnecter Suunto retire les guides envoyés et oublie l’accès ; vos séances restent dans TriCoach.</li>
        </ul>
      </div>
    </Panel>
  );
}
