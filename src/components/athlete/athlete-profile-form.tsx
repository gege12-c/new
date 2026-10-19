"use client";

import { useActionState, useState } from "react";
import { updateAthleteProfile } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

type Values = {
  main_goal: string | null;
  experience_level: string | null;
  weekly_hours_target: number | null;
  notes: string | null;
};

/** Objectifs de l'athlète. Champs contrôlés : un texte en cours n'est jamais perdu après une erreur. */
export function AthleteProfileForm({ values }: { values: Values }) {
  const [state, action] = useActionState(updateAthleteProfile, idle);
  const [goal, setGoal] = useState(values.main_goal ?? "");
  const [level, setLevel] = useState(values.experience_level ?? "");
  const [hours, setHours] = useState(values.weekly_hours_target === null ? "" : String(values.weekly_hours_target).replace(".", ","));
  const [notes, setNotes] = useState(values.notes ?? "");
  return (
    <form action={action} className="space-y-4">
      <Field label="Objectif principal" htmlFor="main_goal">
        <Input id="main_goal" name="main_goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="Se qualifier pour Kona" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Niveau" htmlFor="experience_level">
          <Select id="experience_level" name="experience_level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Non précisé</option>
            <option value="beginner">Débutant</option>
            <option value="intermediate">Intermédiaire</option>
            <option value="advanced">Confirmé</option>
            <option value="elite">Élite</option>
          </Select>
        </Field>
        <Field label="Volume visé (h par semaine)" htmlFor="weekly_hours_target">
          <Input
            id="weekly_hours_target"
            name="weekly_hours_target"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="tabular"
            placeholder="12"
          />
        </Field>
      </div>
      <Field label="Informations pour le coach" htmlFor="notes" hint="Contraintes d’emploi du temps, matériel, antécédents utiles…">
        <Textarea id="notes" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary">Enregistrer les objectifs</SubmitButton>
    </form>
  );
}
