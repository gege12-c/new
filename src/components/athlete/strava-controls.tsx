"use client";

import { RefreshCw, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { disconnectStravaAction, syncStravaNow } from "@/app/(app)/activity-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";

/** Synchronisation manuelle et déconnexion de Strava (la révocation et l’effacement se font côté serveur). */
export function StravaControls() {
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<{ status: "ok"; message?: string } | { status: "error"; message: string }>, after?: () => void) =>
    start(async () => {
      const result = await action();
      setMessage(result.status === "ok" ? { tone: "success", text: result.message ?? "C’est fait." } : { tone: "error", text: result.message });
      after?.();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(syncStravaNow)}>
          <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
          Synchroniser maintenant
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
          <Unplug aria-hidden />
          Déconnecter Strava
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ConfirmDialog
        open={confirm}
        title="Déconnecter Strava ?"
        confirmLabel="Déconnecter"
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => run(disconnectStravaAction, () => setConfirm(false))}
      >
        TriCoach retire son accès à votre compte Strava et efface aussitôt toutes vos données Strava. Vos retours de séance et vos fichiers FIT importés sont
        conservés.
      </ConfirmDialog>
    </div>
  );
}
