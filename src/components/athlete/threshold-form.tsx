"use client";

import { useActionState, useState } from "react";
import { addThreshold } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle, type ActionState } from "@/lib/action-state";
import { THRESHOLD_DEFS } from "@/lib/thresholds";

/**
 * Nouvelle valeur d'un seuil. Champs contrôlés : après une erreur, la saisie et la date restent en
 * place (React remet à zéro les champs libres d'un formulaire à chaque envoi) ; après un succès, la
 * valeur est vidée et la date gardée, pour enchaîner les seuils d'un même test.
 */
export function ThresholdForm({ athleteId, today }: { athleteId: string; today: string }) {
  const [key, setKey] = useState(THRESHOLD_DEFS[0].key);
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(today);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await addThreshold(previous, formData);
    if (result.status === "success") setValue("");
    return result;
  }, idle);
  const def = THRESHOLD_DEFS.find((d) => d.key === key) ?? THRESHOLD_DEFS[0];
  const groups = [...new Set(THRESHOLD_DEFS.map((d) => d.group))];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="athlete_id" value={athleteId} />
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <Field label="Seuil" htmlFor="threshold-key">
          <Select
            id="threshold-key"
            name="key"
            value={key}
            onChange={(e) => {
              // Une valeur tapée pour un autre seuil n'a pas la même unité.
              setKey(e.target.value);
              setValue("");
            }}
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {THRESHOLD_DEFS.filter((d) => d.group === group).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label} ({d.unit})
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={`Valeur (${def.unit})`} htmlFor="threshold-value" hint={def.help}>
          <Input
            id="threshold-value"
            name="value"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={def.input === "pace" ? "text" : "decimal"}
            autoComplete="off"
            placeholder={def.input === "pace" ? "4:10" : undefined}
            className="tabular"
          />
        </Field>
        <Field label="À partir du" htmlFor="threshold-date">
          <Input id="threshold-date" name="effective_from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="secondary">
        Enregistrer le seuil
      </SubmitButton>
    </form>
  );
}
