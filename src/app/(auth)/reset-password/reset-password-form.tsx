"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";
import { updatePassword } from "../actions";

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePassword, idle);
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label="Nouveau mot de passe" htmlFor="password" hint="8 caractères minimum.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirmation" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Enregistrement…">
        Changer le mot de passe
      </SubmitButton>
    </form>
  );
}
