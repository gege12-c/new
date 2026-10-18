"use client";

import { useActionState } from "react";
import { updateAccount } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

export function AccountForm({
  values,
  timezones,
}: {
  values: { display_name: string; timezone: string; is_coach: boolean };
  timezones: string[];
}) {
  const [state, action] = useActionState(updateAccount, idle);
  return (
    <form action={action} className="space-y-4">
      <Field label="Nom affiché" htmlFor="display_name">
        <Input id="display_name" name="display_name" defaultValue={values.display_name} required maxLength={80} />
      </Field>
      <Field label="Fuseau horaire" htmlFor="timezone" hint="Les dates et heures des séances suivent ce fuseau. Pensez-y si vous vivez à l’étranger.">
        <Input id="timezone" name="timezone" defaultValue={values.timezone} list="timezones" required autoComplete="off" />
        <datalist id="timezones">
          {timezones.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      </Field>
      <Checkbox
        name="is_coach"
        defaultChecked={values.is_coach}
        label="Mode coach"
        hint="Ajoute l’espace « Mes athlètes » : invitations, fiches athlètes et planification."
      />
      <FormMessage state={state} />
      <SubmitButton variant="secondary">Enregistrer les réglages</SubmitButton>
    </form>
  );
}
