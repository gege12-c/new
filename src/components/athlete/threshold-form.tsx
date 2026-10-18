"use client";

import { useActionState, useState } from "react";
import { addThreshold } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";
import { THRESHOLD_DEFS } from "@/lib/thresholds";

export function ThresholdForm({ athleteId, today }: { athleteId: string; today: string }) {
  const [state, action] = useActionState(addThreshold, idle);
  const [key, setKey] = useState(THRESHOLD_DEFS[0].key);
  const def = THRESHOLD_DEFS.find((d) => d.key === key) ?? THRESHOLD_DEFS[0];
  const groups = [...new Set(THRESHOLD_DEFS.map((d) => d.group))];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="athlete_id" value={athleteId} />
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <Field label="Seuil" htmlFor="threshold-key">
          <Select id="threshold-key" name="key" value={key} onChange={(e) => setKey(e.target.value)}>
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
            inputMode={def.input === "pace" ? "text" : "decimal"}
            placeholder={def.input === "pace" ? "4:10" : undefined}
            className="tabular"
          />
        </Field>
        <Field label="À partir du" htmlFor="threshold-date">
          <Input id="threshold-date" name="effective_from" type="date" defaultValue={today} required />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="secondary">
        Enregistrer le seuil
      </SubmitButton>
    </form>
  );
}
