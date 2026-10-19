"use client";

import { useState, useTransition } from "react";
import { setAdminRole } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

/** Donner ou retirer l'administration, avec confirmation. */
export function AdminRoleButton({ userId, isAdmin, self, name }: { userId: string; isAdmin: boolean; self: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = () =>
    start(async () => {
      const result = await setAdminRole(userId, !isAdmin);
      setOpen(false);
      setMessage(result.status === "error" ? result.message : null);
    });
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(true)}>
        {isAdmin ? "Retirer l’administration" : "Donner l’administration"}
      </Button>
      {message ? <span className="max-w-56 text-right text-[12px] text-danger">{message}</span> : null}
      <ConfirmDialog
        open={open}
        title={isAdmin ? `Retirer l’administration à ${name} ?` : `Donner l’administration à ${name} ?`}
        confirmLabel={isAdmin ? "Retirer" : "Donner"}
        tone={isAdmin ? "danger" : "primary"}
        pending={pending}
        onConfirm={run}
        onCancel={() => setOpen(false)}
      >
        {isAdmin
          ? self
            ? "Vous n’aurez plus accès à cette page."
            : "Ce compte n’aura plus accès à l’administration."
          : "Ce compte verra la configuration, les journaux techniques et la liste des comptes, jamais les données sportives."}
      </ConfirmDialog>
    </span>
  );
}
