"use client";

import { useActionState } from "react";
import { addEvent } from "@/app/(app)/actions";
import { EVENT_SPORT_LABELS } from "@/components/sport";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

export function EventForm({ athleteId, today }: { athleteId: string; today: string }) {
  const [state, action] = useActionState(addEvent, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="athlete_id" value={athleteId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" htmlFor="event-name">
          <Input id="event-name" name="name" required maxLength={120} placeholder="Ironman Nice" />
        </Field>
        <Field label="Date" htmlFor="event-date">
          <Input id="event-date" name="event_date" type="date" min={today} required />
        </Field>
        <Field label="Priorité" htmlFor="event-priority" hint="A : objectif principal de la saison.">
          <Select id="event-priority" name="priority" defaultValue="B">
            <option value="A">A : objectif principal</option>
            <option value="B">B : course importante</option>
            <option value="C">C : préparation</option>
          </Select>
        </Field>
        <Field label="Discipline" htmlFor="event-sport">
          <Select id="event-sport" name="sport" defaultValue="triathlon">
            {Object.entries(EVENT_SPORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Format" htmlFor="event-distance">
          <Input id="event-distance" name="distance_label" maxLength={60} placeholder="Ironman, 70.3, distance olympique…" />
        </Field>
        <Field label="Lieu" htmlFor="event-location">
          <Input id="event-location" name="location" maxLength={120} />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="secondary">
        Ajouter la compétition
      </SubmitButton>
    </form>
  );
}
