"use client";

import { Download } from "lucide-react";
import { useActionState, useState } from "react";
import { deleteAccount } from "@/app/(app)/account-actions";
import { buttonClasses } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { DELETE_CONFIRMATION } from "@/lib/account";
import { idle } from "@/lib/action-state";

/** Vos données : les télécharger, ou supprimer le compte et tout ce qui lui appartient. */
export function AccountData({ isCoach }: { isCoach: boolean }) {
  const [state, action] = useActionState(deleteAccount, idle);
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toUpperCase() === DELETE_CONFIRMATION;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <a href="/api/me/export" download className={buttonClasses("secondary", "md")}>
          <Download aria-hidden />
          Télécharger mes données
        </a>
        <p className="max-w-prose text-[13px] text-muted">
          Un fichier JSON avec votre profil, vos seuils, compétitions, séances, commentaires, retours, fichiers importés, exports et notifications. Les activités
          reçues de Strava restent sur Strava.
        </p>
      </div>

      <form action={action} className="space-y-3 border-t border-line pt-5">
        <h3 className="text-[15px] font-semibold text-danger">Supprimer mon compte</h3>
        <div className="max-w-prose space-y-2 text-[14px] text-ink-soft">
          <p>
            Votre compte et toutes vos données sont effacés définitivement : profil sportif, seuils, compétitions, séances, commentaires, activités, exports et
            notifications. Si Strava est connecté, l’accès est d’abord révoqué.
          </p>
          {isCoach ? (
            <p>
              En tant que coach : vos relations, invitations et modèles disparaissent, ainsi que vos brouillons. Les séances déjà publiées restent chez vos
              athlètes.
            </p>
          ) : null}
        </div>
        <Field label={`Pour confirmer, tapez ${DELETE_CONFIRMATION}`} htmlFor="delete-confirm" className="max-w-xs">
          <Input id="delete-confirm" name="confirm" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
        </Field>
        <FormMessage state={state} />
        <SubmitButton variant="danger" disabled={!confirmed} pendingLabel="Suppression…">
          Supprimer définitivement mon compte
        </SubmitButton>
      </form>
    </div>
  );
}
