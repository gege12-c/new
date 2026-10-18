"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Boîte de dialogue modale native (<dialog>) : focus piégé, Échap pour fermer. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(440px,calc(100vw-32px))] rounded-[16px] border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-night/45 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      {open ? (
        <div className="p-5 sm:p-6">
          <h2 className="heading text-[19px]">{title}</h2>
          <div className="mt-2">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "danger",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="text-[15px] text-ink-soft">{children}</div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Annuler
        </Button>
        <Button
          variant={tone === "danger" ? "primary" : "primary"}
          className={tone === "danger" ? "bg-danger text-white" : undefined}
          onClick={onConfirm}
          disabled={pending}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
