"use client";

import { useActionState } from "react";
import { saveNotificationPreferences } from "@/app/(app)/notification-actions";
import { FormMessage } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";
import { KIND_LABELS, NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notifications/messages";

/** Types de notifications reçus : tout est actif par défaut, chacun se coupe ici. */
export function NotificationPreferencesForm({ disabled, isCoach }: { disabled: NotificationKind[]; isCoach: boolean }) {
  const [state, action] = useActionState(saveNotificationPreferences, idle);
  const kinds = NOTIFICATION_KINDS.filter((kind) => KIND_LABELS[kind].audience !== "coach" || isCoach);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-3">
        <legend className="sr-only">Notifications reçues</legend>
        {kinds.map((kind) => (
          <Checkbox key={kind} name="kind" value={kind} defaultChecked={!disabled.includes(kind)} label={KIND_LABELS[kind].label} hint={KIND_LABELS[kind].hint} />
        ))}
      </fieldset>
      {/* Les types réservés aux coachs restent actifs tant que le mode coach est coupé. */}
      {!isCoach ? <input type="hidden" name="kind" value="export_failed" /> : null}
      <FormMessage state={state} />
      <SubmitButton variant="secondary">Enregistrer</SubmitButton>
    </form>
  );
}
