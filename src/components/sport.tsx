import { SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

const SPORT_BG: Record<SessionSport, string> = {
  swim: "bg-swim",
  bike: "bg-bike",
  run: "bg-run",
  strength: "bg-strength",
  brick: "bg-brick",
  other: "bg-rest",
};

export function SportDot({ sport, className }: { sport: SessionSport; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", SPORT_BG[sport], className)} />;
}

export function SportLabel({ sport }: { sport: SessionSport }) {
  return (
    <span className="inline-flex items-center gap-2">
      <SportDot sport={sport} />
      {SPORT_LABELS[sport]}
    </span>
  );
}

export const EVENT_SPORT_LABELS: Record<string, string> = {
  triathlon: "Triathlon",
  duathlon: "Duathlon",
  run: "Course à pied",
  bike: "Vélo",
  swim: "Natation",
  other: "Autre",
};

const PRIORITY_STYLES: Record<string, string> = {
  A: "bg-accent text-accent-ink",
  B: "bg-accent-soft text-accent",
  C: "bg-surface-2 text-muted",
};

/** Priorité d'une compétition : A = objectif principal. */
export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-semibold", PRIORITY_STYLES[priority])}
      title={`Priorité ${priority}`}
    >
      {priority}
    </span>
  );
}
