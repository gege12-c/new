"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/** Menu d’actions accessible au clavier : Échap ferme, flèches pour naviguer. */
export function Menu({
  label,
  trigger,
  items,
  onSelect,
  align = "end",
  className,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  onSelect: (key: string) => void;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("[data-menu-trigger]")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const entries = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next = entries[(index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length];
    next?.focus();
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        data-menu-trigger
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex size-10 items-center justify-center rounded-[8px] border border-line-strong bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink [&_svg]:size-[18px]"
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={move}
          className={cn(
            "absolute top-[calc(100%+6px)] z-40 min-w-[230px] rounded-[10px] border border-line bg-surface p-1 shadow-pop",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                onSelect(item.key);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-[14px] outline-none hover:bg-surface-2 focus:bg-surface-2 disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted",
                item.tone === "danger" && "text-danger [&_svg]:text-danger",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
