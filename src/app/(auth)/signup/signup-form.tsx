"use client";

import { useActionState, useSyncExternalStore } from "react";
import { FormMessage } from "@/components/ui/feedback";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";
import { signUp } from "../actions";

const subscribeNever = () => () => {};

export function SignupForm({ next, invited }: { next: string; invited: boolean }) {
  const [state, action] = useActionState(signUp, idle);
  // Fuseau horaire du navigateur, pour afficher les séances à la bonne heure.
  const timezone = useSyncExternalStore(
    subscribeNever,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "Europe/Paris",
  );

  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="timezone" value={timezone} />
      <Field label="Nom affiché" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required maxLength={80} />
      </Field>
      <Field
        label="Email"
        htmlFor="email"
        hint={invited ? "Utilisez l’adresse à laquelle votre coach vous a invité." : undefined}
      >
        <Input id="email" name="email" type="email" autoComplete="email" required inputMode="email" />
      </Field>
      <Field label="Mot de passe" htmlFor="password" hint="8 caractères minimum.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {invited ? null : (
        <Checkbox name="coach" label="J’entraîne des athlètes" hint="Active l’espace coach. Modifiable plus tard." />
      )}
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Création du compte…">
        Créer mon compte
      </SubmitButton>
    </form>
  );
}
