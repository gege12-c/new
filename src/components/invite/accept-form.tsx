"use client";

import { useActionState } from "react";
import { acceptInvitation } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";

export function AcceptInvitationForm({ token, coachName }: { token: string; coachName: string }) {
  const [state, action] = useActionState(acceptInvitation, idle);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Acceptation…">
        Accepter et donner accès à {coachName}
      </SubmitButton>
    </form>
  );
}
