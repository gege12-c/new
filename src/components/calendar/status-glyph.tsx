import type { SessionStatus } from "@/lib/planning/status";
import { cn } from "@/lib/utils";

/**
 * Marque de réalisation d’une séance : pleine et cochée quand elle est faite, à moitié remplie si
 * partielle, barrée si manquée, en pointillé tant qu’elle reste à rapprocher.
 */
export function StatusGlyph({ status, className }: { status: SessionStatus; className?: string }) {
  const box = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "done":
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn(box, "text-success")}>
          <circle cx="8" cy="8" r="7.25" fill="currentColor" />
          <path d="M4.9 8.3 7 10.3l4.2-4.6" fill="none" stroke="var(--surface)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "partial":
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn(box, "text-warning")}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.5a6.5 6.5 0 0 0 0 13Z" fill="currentColor" />
        </svg>
      );
    case "missed":
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn(box, "text-danger")}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "unreconciled":
      return (
        <svg viewBox="0 0 16 16" aria-hidden className={cn(box, "text-muted")}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.1" />
        </svg>
      );
    default:
      return null;
  }
}
