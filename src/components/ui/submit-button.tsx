"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button } from "./button";

/** Bouton d'envoi qui indique l'enregistrement en cours et empêche le double envoi. */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </Button>
  );
}
