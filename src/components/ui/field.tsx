import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const controlClasses =
  "block w-full rounded-[8px] border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-muted/70 " +
  "transition-[border-color,box-shadow] focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/12 " +
  "disabled:opacity-60 aria-[invalid=true]:border-danger";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-10", className)} {...props} />;
}

/** Liste déroulante native, avec un chevron dessiné (l’apparence native est retirée pour l’homogénéité). */
export function Select({
  className,
  wrapperClassName,
  size = "md",
  ...props
}: Omit<ComponentProps<"select">, "size"> & { wrapperClassName?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("relative block", wrapperClassName)}>
      <select
        className={cn(
          controlClasses,
          "appearance-none",
          size === "sm" ? "h-8 rounded-[6px] pl-2 pr-7 text-[13px] font-medium" : "h-10 pr-9",
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted", size === "sm" ? "right-1.5 size-3.5" : "right-3 size-4")}
      />
    </span>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

export function Checkbox({ label, hint, className, ...props }: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 text-[15px]", className)}>
      <input type="checkbox" className="mt-[3px] size-[18px] shrink-0 rounded accent-[var(--ink)]" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
