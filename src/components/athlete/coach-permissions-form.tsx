"use client";

import { useActionState } from "react";
import { setCoachPermissions } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

export function CoachPermissionsForm({
  linkId,
  canEditPlan,
  canViewActivities,
}: {
  linkId: string;
  canEditPlan: boolean;
  canViewActivities: boolean;
}) {
  const [state, action] = useActionState(setCoachPermissions, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="link_id" value={linkId} />
      <Checkbox
        name="can_edit_plan"
        defaultChecked={canEditPlan}
        label="Peut planifier mes séances"
        hint="Créer, modifier et déplacer les séances, mettre à jour mes seuils et compétitions."
      />
      <Checkbox
        name="can_view_activities"
        defaultChecked={canViewActivities}
        label="Peut voir mes activités importées"
        hint="Les fichiers FIT que vous importez. Vos activités Strava restent visibles de vous seul (règles de Strava) ; vos retours de séance sont toujours partagés."
      />
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="secondary">
        Enregistrer les permissions
      </SubmitButton>
    </form>
  );
}
