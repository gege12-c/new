"use client";

import Link from "next/link";
import { SPORT_ICONS, SPORT_STYLES } from "@/components/sport";
import { activityDuration } from "@/lib/activities/compare";
import type { LinkedActivity } from "@/lib/activities/realization";
import { formatDistance, formatDurationShort, formatTimeOfDay } from "@/lib/workout/format";
import { activityTitle } from "@/lib/activities/labels";
import { cn } from "@/lib/utils";

/** Activité réalisée sans séance rattachée : fond teinté de sa discipline, pour la distinguer du prévu. */
export function ActivityChip({
  activity,
  href,
  size = "regular",
  selected = false,
}: {
  activity: LinkedActivity;
  href: string;
  size?: "compact" | "regular" | "large";
  selected?: boolean;
}) {
  const Icon = SPORT_ICONS[activity.sport];
  const style = SPORT_STYLES[activity.sport];
  const duration = activityDuration(activity);
  const toValidate = activity.links.some((l) => l.status === "proposed");
  const title = activityTitle(activity);
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      aria-label={`${title}, activité réalisée${toValidate ? " à valider" : " sans séance"}${duration ? `, ${formatDurationShort(duration)}` : ""}`}
      className={cn(
        "block rounded-[8px] border border-transparent text-left transition-[box-shadow,border-color]",
        style.soft,
        size === "compact" ? "px-2 py-1" : size === "regular" ? "px-2.5 py-1.5" : "px-3.5 py-2.5",
        selected ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "hover:border-line-strong",
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5 shrink-0", style.ink)} strokeWidth={2.4} aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate font-semibold text-ink", size === "large" ? "text-[14px]" : "text-[12.5px]")}>{title}</span>
        {toValidate ? <span title="Rattachement à valider" className="size-1.5 shrink-0 rounded-full bg-warning" /> : null}
      </span>
      {size !== "compact" ? (
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink-soft">
          {duration ? <span className="figure">{formatDurationShort(duration)}</span> : null}
          {activity.distance_m ? <span className="figure">{formatDistance(activity.distance_m, activity.sport === "swim" ? "swim" : undefined)}</span> : null}
          {activity.local_start_time ? <span className="figure text-muted">{formatTimeOfDay(activity.local_start_time)}</span> : null}
          <span className="text-muted">{toValidate ? "À valider" : "Sans séance"}</span>
        </span>
      ) : null}
    </Link>
  );
}
