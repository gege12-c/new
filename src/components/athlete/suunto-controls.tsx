"use client";

import { Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectSuuntoAction } from "@/app/(app)/suunto-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";

/** Déconnexion du compte Suunto (le retrait des guides se fait côté serveur). */
export function SuuntoControls() {
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
        <Unplug aria-hidden />
        Déconnecter Suunto
      </Button>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <ConfirmDialog
        open={confirm}
        title="Déconnecter Suunto ?"
        confirmLabel="Déconnecter"
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            const result = await disconnectSuuntoAction();
            setConfirm(false);
            if (result.status === "ok") {
              // Le panneau se re-rend sans ce composant : le message passe par l'adresse de la page.
              router.replace(`/athlete/profile?suunto=${result.guidesLeft ? "disconnected_partial" : "disconnected"}#montre-suunto`);
              return;
            }
            setMessage({ tone: "error", text: result.message });
          })
        }
      >
        TriCoach retire les séances qu’il a envoyées sur votre compte Suunto et oublie l’accès. Vos séances dans TriCoach ne changent pas.
      </ConfirmDialog>
    </div>
  );
}
