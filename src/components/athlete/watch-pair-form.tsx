"use client";

import { useActionState, useState } from "react";
import { confirmWatchPairing } from "@/app/(app)/watch-actions";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle, type ActionState } from "@/lib/action-state";

/** Saisie du code affiché par l'application TriCoach de la montre (gardé après une erreur, vidé après succès). */
export function WatchPairForm() {
  const [code, setCode] = useState("");
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await confirmWatchPairing(previous, formData);
    if (result.status === "success") setCode("");
    return result;
  }, idle);
  return (
    <form action={action} className="space-y-3">
      <Field label="Code affiché par la montre" htmlFor="watch-code" hint="8 caractères, par exemple K7QX-4PRM. Il reste valable 10 minutes.">
        <Input
          id="watch-code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          placeholder="K7QX-4PRM"
          className="tabular max-w-[12rem] tracking-[0.12em]"
          required
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="sm" pendingLabel="Association…">
        Associer la montre
      </SubmitButton>
    </form>
  );
}
