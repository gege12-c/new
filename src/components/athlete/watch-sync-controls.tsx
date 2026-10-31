"use client";

import { Send, Unplug } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { connectIntervalsAction, disconnectIntervalsAction, disconnectSuuntoAction, sendToWatchNow } from "@/app/(app)/device-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormMessage, Notice } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle, type ActionState } from "@/lib/action-state";

/** Clé API intervals.icu : envoyée une fois au serveur, qui la vérifie puis la garde chiffrée. */
export function IntervalsKeyForm({ again = false }: { again?: boolean }) {
  const [key, setKey] = useState("");
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await connectIntervalsAction(previous, formData);
    if (result.status === "success") setKey("");
    return result;
  }, idle);
  return (
    <form action={action} className="space-y-3">
      <Field label="Clé API intervals.icu" htmlFor="intervals-key" hint="Elle reste sur le serveur de TriCoach, chiffrée ; elle n’est plus jamais affichée.">
        <Input
          id="intervals-key"
          name="key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className="max-w-[24rem]"
          required
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="sm" pendingLabel="Vérification…">
        {again ? "Enregistrer la nouvelle clé" : "Relier intervals.icu"}
      </SubmitButton>
    </form>
  );
}

type Result = { status: "ok" | "error"; message: string };

/** Nouvel envoi et déliaison d'un compte (intervals.icu ou Suunto). */
export function WatchSyncControls({ provider }: { provider: "intervals" | "suunto" }) {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const name = provider === "intervals" ? "intervals.icu" : "Suunto";
  const run = (action: () => Promise<Result>, then?: () => void) =>
    start(async () => {
      const result = await action();
      setMessage({ tone: result.status === "ok" ? "success" : "error", text: result.message });
      then?.();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(sendToWatchNow)}>
          <Send aria-hidden />
          Envoyer maintenant
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
          <Unplug aria-hidden />
          Délier {name}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ConfirmDialog
        open={confirm}
        title={`Délier ${name} ?`}
        confirmLabel="Délier"
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => run(provider === "intervals" ? disconnectIntervalsAction : disconnectSuuntoAction, () => setConfirm(false))}
      >
        TriCoach retire de {name} les séances à venir qu’il y a déposées, puis oublie {provider === "intervals" ? "votre clé" : "ses accès"}. Vos séances restent dans TriCoach.
      </ConfirmDialog>
    </div>
  );
}
