"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";
import { requestPasswordReset } from "../actions";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, idle);
  if (state.status === "success") return <div className="mt-6"><FormMessage state={state} /></div>;
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required inputMode="email" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Envoi…">
        Recevoir le lien
      </SubmitButton>
    </form>
  );
}
