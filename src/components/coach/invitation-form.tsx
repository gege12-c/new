"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useActionState, useState } from "react";
import { createInvitation } from "@/app/(app)/actions";
import { buttonClasses } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

const expiryFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

export function InvitationForm({ coachName }: { coachName: string }) {
  const [state, action] = useActionState(createInvitation, idle);
  const [copied, setCopied] = useState<string | null>(null);
  const link = state.status === "success" ? state.data?.link : undefined;
  const email = state.status === "success" ? state.data?.email : undefined;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setCopied(null);
      window.prompt("Copiez le lien :", value);
    }
  }

  const mailto = link
    ? `mailto:${email ?? ""}?subject=${encodeURIComponent(`${coachName} vous invite à suivre votre entraînement`)}&body=${encodeURIComponent(
        `Bonjour,\n\nPour que je puisse planifier et suivre ton entraînement, ouvre ce lien et accepte l'invitation :\n${link}\n\nÀ bientôt,\n${coachName}`,
      )}`
    : undefined;

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end">
        <Field label="Email de l'athlète (facultatif)" htmlFor="invite-email" hint="Avec un email, seule cette adresse pourra accepter.">
          <Input id="invite-email" name="email" type="email" inputMode="email" autoComplete="off" />
        </Field>
        <Field label="Validité" htmlFor="invite-validity" hint="Le lien ne sert qu'une fois.">
          <Select id="invite-validity" name="valid_days" defaultValue="7">
            <option value="1">1 jour</option>
            <option value="7">7 jours</option>
            <option value="30">30 jours</option>
          </Select>
        </Field>
        <SubmitButton className="sm:mb-6" pendingLabel="Création…">
          Créer le lien
        </SubmitButton>
      </form>
      <FormMessage state={state} />

      {link ? (
        <div className="rounded-md border border-success/30 bg-success-soft p-4">
          <p className="font-medium text-success">Lien d&apos;invitation prêt</p>
          <p className="mt-1 text-sm text-muted">
            Envoyez-le à votre athlète. Il expire le {expiryFormatter.format(new Date(state.data!.expiresAt))}. Il n&apos;est affiché
            qu&apos;une fois : copiez-le maintenant.
          </p>
          <p className="mt-3 break-all rounded border border-line bg-surface px-3 py-2 font-mono text-[13px]">{link}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => copy(link)}>
              {copied === link ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied === link ? "Lien copié" : "Copier le lien"}
            </Button>
            <a className={buttonClasses("secondary", "sm")} href={mailto}>
              <Mail className="size-4" aria-hidden />
              Préparer un email
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
