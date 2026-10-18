"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button } from "./button";

/** Bouton d'envoi qui demande confirmation avant une action destructrice. */
export function ConfirmSubmit({
  confirmMessage,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "type" | "onClick"> & { confirmMessage: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
