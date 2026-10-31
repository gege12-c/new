import { CalendarOff, Flag } from "lucide-react";
import Link from "next/link";
import { PriorityBadge, SPORT_STYLES } from "@/components/sport";
import type { SeasonData } from "@/lib/data/season";
import { calendarHref } from "@/lib/planning/calendar-query";
import { addDays, formatDayMonth, isoWeekNumber } from "@/lib/planning/dates";
import { isUnavailability, noteTitle } from "@/lib/planning/notes";
import { plannedVolume } from "@/lib/planning/volume";
import { formatDurationShort } from "@/lib/workout/format";
import { SPORT_LABELS } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

/**
 * Saison en un coup d’œil : une ligne par semaine, volume prévu par discipline (barre empilée), réalisé
 * des semaines passées, compétitions et jours indisponibles. Les semaines vides restent visibles.
 */
export function SeasonView({ data, today, calendarBase }: { data: SeasonData; today: string; calendarBase: string }) {
  const weeks = data.mondays.map((monday) => {
    const sunday = addDays(monday, 6);
    const sessions = data.sessions.filter((s) => s.scheduled_date >= monday && s.scheduled_date <= sunday && s.state === "published");
    const drafts = data.sessions.filter((s) => s.scheduled_date >= monday && s.scheduled_date <= sunday && s.state === "draft").length;
    return {
      monday,
      sunday,
      volume: plannedVolume(sessions),
      drafts,
      realized: monday <= today ? (data.realized?.get(monday) ?? null) : null,
      events: data.events.filter((e) => e.event_date >= monday && e.event_date <= sunday),
      notes: data.notes.filter((n) => isUnavailability(n) && n.start_date <= sunday && n.end_date >= monday),
    };
  });
  const max = Math.max(3600, ...weeks.map((w) => Math.max(w.volume.totalSeconds, w.realized ?? 0)));
  const sports = [...new Set(weeks.flatMap((w) => w.volume.bySport.map((v) => v.sport)))];

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {sports.map((sport) => (
          <span key={sport} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-2.5 rounded-full", SPORT_STYLES[sport].solid)} aria-hidden />
            {SPORT_LABELS[sport]}
          </span>
        ))}
        {data.realized ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-ink" aria-hidden /> réalisé (fichiers et montre)
          </span>
        ) : null}
        <span>Séances publiées ; brouillons comptés à part.</span>
      </p>
      <ol className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {weeks.map((week) => {
          const current = week.monday <= today && today <= week.sunday;
          return (
            <li key={week.monday} className={cn("grid grid-cols-[86px_minmax(0,1fr)] items-center gap-3 border-b border-line px-3 py-1.5 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,0.9fr)]", current && "bg-surface-2/70")}>
              <Link href={calendarHref(calendarBase, { view: "week", date: week.monday })} className="min-w-0 hover:underline">
                <span className={cn("block text-[12.5px] font-semibold", current ? "text-ink" : "text-ink-soft")}>Sem. {isoWeekNumber(week.monday)}</span>
                <span className="figure block text-[11.5px] text-muted">{formatDayMonth(week.monday)}</span>
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="flex h-full" style={{ width: `${(week.volume.totalSeconds / max) * 100}%` }}>
                      {week.volume.bySport.map((v) => (
                        <span key={v.sport} className={SPORT_STYLES[v.sport].solid} style={{ width: `${(v.seconds / Math.max(1, week.volume.totalSeconds)) * 100}%` }} />
                      ))}
                    </div>
                    {week.realized !== null ? <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${Math.min(100, (week.realized / max) * 100)}% - 1px)` }} /> : null}
                  </div>
                  <span className="figure w-[4.5rem] shrink-0 text-right text-[12.5px] text-ink">
                    {week.volume.totalSeconds ? formatDurationShort(week.volume.totalSeconds) : "—"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted empty:hidden">
                  {week.realized !== null ? `Réalisé ${week.realized ? formatDurationShort(week.realized) : "0 min"}` : null}
                  {week.realized !== null && week.drafts ? ", " : null}
                  {week.drafts ? `${week.drafts} brouillon${week.drafts > 1 ? "s" : ""}` : null}
                  {week.volume.unknownDuration ? `${week.realized !== null || week.drafts ? ", " : ""}${week.volume.unknownDuration} sans durée` : null}
                </p>
              </div>
              <div className="col-span-2 flex min-w-0 flex-wrap gap-1.5 sm:col-span-1">
                {week.events.map((e) => (
                  <span key={e.id} className="flex items-center gap-1 rounded-[6px] bg-ink px-1.5 py-0.5 text-[11.5px] font-semibold text-canvas">
                    <Flag className="size-3" aria-hidden />
                    <span className="truncate">{e.name}</span>
                    <PriorityBadge priority={e.priority} />
                  </span>
                ))}
                {week.notes.map((n) => (
                  <span key={n.id} className="flex items-center gap-1 rounded-[6px] border border-warning/40 bg-warning-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-ink">
                    <CalendarOff className="size-3" aria-hidden />
                    <span className="truncate">{noteTitle(n)}</span>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
