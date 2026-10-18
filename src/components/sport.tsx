import { Bike, CircleDot, Dumbbell, Footprints, Layers, Waves, type LucideIcon } from "lucide-react";
import { SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

/** Classes de couleur par discipline : plein, fond teinté, texte sur fond teinté, filet. */
export const SPORT_STYLES: Record<SessionSport, { solid: string; soft: string; ink: string; border: string; text: string }> = {
  swim: { solid: "bg-swim", soft: "bg-swim-soft", ink: "text-swim-ink", border: "border-swim", text: "text-swim" },
  bike: { solid: "bg-bike", soft: "bg-bike-soft", ink: "text-bike-ink", border: "border-bike", text: "text-bike" },
  run: { solid: "bg-run", soft: "bg-run-soft", ink: "text-run-ink", border: "border-run", text: "text-run" },
  strength: {
    solid: "bg-strength",
    soft: "bg-strength-soft",
    ink: "text-strength-ink",
    border: "border-strength",
    text: "text-strength",
  },
  brick: { solid: "bg-brick", soft: "bg-brick-soft", ink: "text-brick-ink", border: "border-brick", text: "text-brick" },
  other: { solid: "bg-other", soft: "bg-other-soft", ink: "text-other-ink", border: "border-other", text: "text-other" },
};

export const SPORT_ICONS: Record<SessionSport, LucideIcon> = {
  swim: Waves,
  bike: Bike,
  run: Footprints,
  strength: Dumbbell,
  brick: Layers,
  other: CircleDot,
};

export const SPORT_SHORT: Record<SessionSport, string> = {
  swim: "Nat.",
  bike: "Vélo",
  run: "CAP",
  strength: "Renfo",
  brick: "Enchaîn.",
  other: "Autre",
};

export function SportDot({ sport, className }: { sport: SessionSport; className?: string }) {
  if (sport === "brick") {
    return (
      <span aria-hidden className={cn("inline-flex size-2.5 shrink-0 overflow-hidden rounded-full", className)}>
        <span className="h-full w-1/2 bg-bike" />
        <span className="h-full w-1/2 bg-run" />
      </span>
    );
  }
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", SPORT_STYLES[sport].solid, className)} />;
}

/** Pastille ronde avec l’icône de la discipline, sur fond teinté. */
export function SportGlyph({ sport, size = "md", className }: { sport: SessionSport; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = SPORT_ICONS[sport];
  const box = { sm: "size-6 [&_svg]:size-3.5", md: "size-8 [&_svg]:size-[18px]", lg: "size-11 [&_svg]:size-6" }[size];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", SPORT_STYLES[sport].soft, SPORT_STYLES[sport].ink, box, className)}
    >
      <Icon strokeWidth={2.2} />
    </span>
  );
}

export function SportLabel({ sport, className }: { sport: SessionSport; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <SportDot sport={sport} />
      {SPORT_LABELS[sport]}
    </span>
  );
}

export function SportBadge({ sport, className }: { sport: SessionSport; className?: string }) {
  const Icon = SPORT_ICONS[sport];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-semibold",
        SPORT_STYLES[sport].soft,
        SPORT_STYLES[sport].ink,
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.4} aria-hidden />
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
  A: "bg-ink text-canvas",
  B: "border border-ink/60 text-ink",
  C: "border border-line-strong text-muted",
};

/** Priorité d’une compétition : A = objectif principal. */
export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={cn("figure inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] px-1.5 text-[12px]", PRIORITY_STYLES[priority])}
      title={`Priorité ${priority}`}
    >
      {priority}
    </span>
  );
}
