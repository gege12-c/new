"use client";

import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Champ texte dont la valeur n’est validée qu’à la sortie (ou Entrée) : une saisie illisible
 * reste affichée en erreur, la valeur précédente est conservée, rien n’est deviné.
 */
export function ValueInput({
  value,
  format,
  parse,
  onCommit,
  className,
  invalidMessage = "Valeur illisible",
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "defaultValue"> & {
  value: number;
  format: (value: number) => string;
  parse: (raw: string) => number | null;
  onCommit: (value: number) => void;
  invalidMessage?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? format(value);
  const invalid = draft !== null && parse(draft) === null;

  const commit = () => {
    if (draft === null) return;
    const parsed = parse(draft);
    if (parsed === null) return;
    if (parsed !== value) onCommit(parsed);
    setDraft(null);
  };

  return (
    <input
      {...props}
      value={shown}
      inputMode={props.inputMode ?? "decimal"}
      autoComplete="off"
      aria-invalid={invalid || undefined}
      title={invalid ? invalidMessage : props.title}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        event.target.select();
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        commit();
        props.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") setDraft(null);
        props.onKeyDown?.(event);
      }}
      className={cn(
        "figure h-8 rounded-[6px] border border-line-strong bg-surface px-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow]",
        "focus:border-ink focus:ring-[3px] focus:ring-ink/12 aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft",
        className,
      )}
    />
  );
}
