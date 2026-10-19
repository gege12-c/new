"use client";

import Link from "next/link";
import type { CSSProperties, DragEvent } from "react";
import { SPORT_ICONS } from "@/components/sport";
import { barClass, profileBars } from "@/components/workout/workout-profile";
import { completionRatio, realizedTotals } from "@/lib/activities/compare";
import type { CalendarSession } from "@/lib/data/planning-types";
import { sessionStatus, STATUS_LABELS, type SessionStatus } from "@/lib/planning/status";
import { formatDistance, formatDurationShort, formatTimeOfDay } from "@/lib/workout/format";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "./status-glyph";

const SPORT_EDGE: Record<string, string> = {
  swim: "before:bg-swim",
  bike: "before:bg-bike",
  run: "before:bg-run",
  strength: "before:bg-strength",
  brick: "before:bg-[linear-gradient(var(--bike)_50%,var(--run)_50%)]",
  other: "before:bg-other",
};

/** Profil miniature : la forme de la séance, sans libellés. */
export function MiniProfile({ session, thresholds, height = 14, className }: { session: CalendarSession; thresholds?: AthleteThresholds; height?: number; className?: string }) {
  let bars: ReturnType<typeof profileBars> = [];
  try {
    bars = profileBars(session.content, thresholds);
  } catch {
    bars = [];
  }
  if (!bars.length) return null;
  return (
    <div aria-hidden className={cn("flex items-end gap-px", className)} style={{ height }}>
      {bars.map((bar) => (
        <span
          key={bar.key}
          className={cn("min-w-px rounded-t-[1px]", barClass(bar), bar.unknownLength && "opacity-50")}
          style={{ flexGrow: bar.grow, flexBasis: 0, height: `${bar.ratio * 100}%` } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function durationLabel(session: Pick<CalendarSession, "planned_duration_s">): string | null {
  return session.planned_duration_s ? formatDurationShort(session.planned_duration_s) : null;
}

const REALIZED_TONE: Partial<Record<SessionStatus, string>> = { done: "text-success", partial: "text-warning", missed: "text-danger" };

/** Ligne « réalisé » d’une séance : durée et part du prévu, ou déclaration de l’athlète. */
export function realizedLabel(session: CalendarSession, status: SessionStatus): { text: string; tone: string } | null {
  const realization = session.realization;
  if (!realization) return null;
  if (realization.attached.length) {
    const totals = realizedTotals(realization.attached);
    const ratio = completionRatio(session, totals);
    const amount = totals.durationS !== null ? formatDurationShort(totals.durationS) : totals.distanceM !== null ? formatDistance(totals.distanceM, session.sport === "swim" ? "swim" : undefined) : null;
    const text = amount ? `Réalisé ${amount}${ratio !== null ? ` (${Math.round(ratio * 100)} %)` : ""}` : "Réalisé";
    return { text, tone: REALIZED_TONE[status] ?? "text-ink-soft" };
  }
  if (realization.completion) {
    const rpe = realization.completion.rpe ? `, RPE ${realization.completion.rpe}` : "";
    return { text: `${STATUS_LABELS[status]}${rpe}`, tone: REALIZED_TONE[status] ?? "text-ink-soft" };
  }
  if (realization.proposals.length) return { text: "Activité à valider", tone: "text-warning" };
  return null;
}

interface ChipProps {
  session: CalendarSession;
  href: string;
  today: string;
  thresholds?: AthleteThresholds;
  size?: "compact" | "regular" | "large";
  draggable?: boolean;
  selected?: boolean;
  onDragStart?: (event: DragEvent, session: CalendarSession) => void;
  onDragEnd?: () => void;
}

/** Séance dans le calendrier : filet de discipline, titre, durée et forme de l’effort. */
export function SessionChip({ session, href, today, thresholds, size = "regular", draggable = false, selected = false, onDragStart, onDragEnd }: ChipProps) {
  const status = sessionStatus(session, today);
  const Icon = SPORT_ICONS[session.sport];
  const duration = durationLabel(session);
  const distance = session.planned_distance_m ? formatDistance(session.planned_distance_m, session.sport === "swim" ? "swim" : undefined) : null;
  const time = session.start_time ? formatTimeOfDay(session.start_time) : null;
  const realized = size === "compact" ? null : realizedLabel(session, status);
  return (
    <Link
      href={href}
      scroll={false}
      draggable={draggable}
      onDragStart={(event) => onDragStart?.(event, session)}
      onDragEnd={onDragEnd}
      aria-current={selected ? "true" : undefined}
      aria-label={`${session.title}, ${STATUS_LABELS[status].toLowerCase()}${duration ? `, ${duration}` : ""}`}
      className={cn(
        "group relative block overflow-hidden rounded-[8px] border bg-surface pl-[11px] text-left transition-[box-shadow,border-color] before:absolute before:inset-y-0 before:left-0 before:w-[4px]",
        SPORT_EDGE[session.sport],
        size === "compact" ? "py-1.5 pr-2" : size === "regular" ? "py-2 pr-2.5" : "py-3 pr-3.5",
        status === "draft" ? "border-dashed border-line-strong bg-surface/70" : "border-line",
        status === "cancelled" && "opacity-55",
        selected ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "hover:border-line-strong hover:shadow-pop",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="flex items-start gap-1.5">
        {size !== "compact" ? <Icon className="mt-[2px] size-3.5 shrink-0 text-muted" strokeWidth={2.4} aria-hidden /> : null}
        <span
          className={cn(
            "min-w-0 flex-1 font-semibold leading-snug text-ink",
            size === "compact" ? "truncate text-[12.5px]" : size === "regular" ? "line-clamp-2 text-[13px]" : "text-[15px]",
            status === "cancelled" && "line-through",
          )}
        >
          {session.title}
        </span>
        {session.pending ? <span title="Modifications non publiées" className="mt-1 size-1.5 shrink-0 rounded-full bg-warning" /> : null}
        <StatusGlyph status={status} className={size === "compact" ? "mt-[1px]" : "mt-[2px]"} />
      </span>
      {size === "compact" ? (
        <span className="mt-1 flex items-center gap-2">
          {duration ? <span className="figure shrink-0 text-[12px] text-ink-soft">{duration}</span> : null}
          <MiniProfile session={session} thresholds={thresholds} height={13} className="min-w-6 flex-1" />
        </span>
      ) : (
        <>
          <span className={cn("mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5", size === "large" && "mt-2")}>
            {duration ? <span className={cn("figure text-ink-soft", size === "large" ? "text-[16px]" : "text-[12.5px]")}>{duration}</span> : null}
            {distance ? <span className="figure text-[12px] text-muted">{distance}</span> : null}
            {time ? <span className="figure text-[12px] text-muted">{time}</span> : null}
          </span>
          <MiniProfile session={session} thresholds={thresholds} height={size === "large" ? 30 : 16} className="mt-1.5" />
          {realized ? <span className={cn("figure mt-1.5 block text-[12px] font-semibold", realized.tone)}>{realized.text}</span> : null}
        </>
      )}
      {status === "draft" || status === "cancelled" ? (
        <span className="mt-1 block text-[11px] font-semibold text-muted">{STATUS_LABELS[status]}</span>
      ) : null}
    </Link>
  );
}
