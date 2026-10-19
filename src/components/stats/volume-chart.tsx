"use client";

import { useState } from "react";
import { SPORT_FILL, SPORT_NAME } from "@/lib/stats/labels";
import { STAT_SPORTS, type WeekVolume } from "@/lib/stats/stats";
import { formatDurationShort } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

const STEPS = [1800, 3600, 2 * 3600, 3 * 3600, 5 * 3600, 10 * 3600];

function axis(max: number) {
  const step = STEPS.find((s) => max / s <= 5) ?? STEPS[STEPS.length - 1];
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

const hours = (seconds: number) => (seconds === 0 ? "0" : seconds % 3600 === 0 ? `${seconds / 3600} h` : formatDurationShort(seconds));
const dayMonth = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** Volume prévu par semaine (colonnes empilées par discipline) et réalisé d'après les fichiers FIT (trait). */
export function VolumeChart({ volumes, showRealized }: { volumes: WeekVolume[]; showRealized: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...volumes.map((v) => Math.max(v.plannedTotal, showRealized ? v.realizedTotal : 0)));
  const { top, ticks } = axis(max);
  const pct = (seconds: number) => `${(seconds / top) * 100}%`;
  const present = STAT_SPORTS.filter((sport) => volumes.some((v) => v.planned[sport] > 0 || v.realized[sport] > 0));

  return (
    <div>
      <div className="relative h-52 pl-11 sm:h-60">
        {ticks.map((tick) => (
          <div key={tick} aria-hidden className="absolute left-11 right-0 border-t border-line" style={{ bottom: pct(tick) }}>
            <span className="figure absolute -left-11 w-9 -translate-y-1/2 text-right text-[11px] text-muted">{hours(tick)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 left-11 right-0 flex items-end">
          {volumes.map((week, index) => {
            const parts = STAT_SPORTS.filter((sport) => week.planned[sport] > 0);
            const label = `Semaine du ${dayMonth(week.week)} : ${week.plannedTotal ? `${formatDurationShort(week.plannedTotal)} prévues` : "rien de prévu"}${
              showRealized ? `, ${week.realizedTotal ? `${formatDurationShort(week.realizedTotal)} réalisées (fichiers FIT)` : "aucun fichier FIT"}` : ""
            }`;
            return (
              <div key={week.week} className="relative flex h-full flex-1 justify-center">
                <button
                  type="button"
                  aria-label={label}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="group relative flex h-full w-full items-end justify-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <span className={cn("flex w-[min(24px,62%)] flex-col-reverse gap-[2px] transition-opacity", active !== null && active !== index && "opacity-55")} style={{ height: pct(week.plannedTotal) }}>
                    {parts.map((sport, i) => (
                      <span key={sport} className={cn("w-full", SPORT_FILL[sport], i === parts.length - 1 && "rounded-t-[4px]")} style={{ flexGrow: week.planned[sport], flexBasis: 0 }} />
                    ))}
                  </span>
                  {showRealized && week.realizedTotal > 0 ? (
                    <span aria-hidden className="absolute h-[2px] w-[calc(min(24px,62%)+12px)] rounded-full bg-ink" style={{ bottom: pct(week.realizedTotal) }} />
                  ) : null}
                </button>
                {active === index ? (
                  <div
                    role="tooltip"
                    className={cn(
                      "pointer-events-none absolute z-10 w-52 rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px] shadow-pop",
                      index < 3 ? "left-0" : index > volumes.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                    style={{ bottom: `calc(${pct(Math.max(week.plannedTotal, week.realizedTotal))} + 10px)` }}
                  >
                    <p className="font-semibold text-ink">Semaine du {dayMonth(week.week)}</p>
                    <dl className="mt-1.5 space-y-1">
                      {parts.map((sport) => (
                        <div key={sport} className="flex items-center gap-2">
                          <span aria-hidden className={cn("h-[2px] w-3 rounded-full", SPORT_FILL[sport])} />
                          <dt className="flex-1 text-ink-soft">{SPORT_NAME[sport]}</dt>
                          <dd className="figure font-semibold text-ink">{formatDurationShort(week.planned[sport])}</dd>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 border-t border-line pt-1">
                        <dt className="flex-1 text-ink-soft">Total prévu</dt>
                        <dd className="figure font-semibold text-ink">{week.plannedTotal ? formatDurationShort(week.plannedTotal) : "—"}</dd>
                      </div>
                      {showRealized ? (
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="h-[2px] w-3 rounded-full bg-ink" />
                          <dt className="flex-1 text-ink-soft">Réalisé (FIT)</dt>
                          <dd className="figure font-semibold text-ink">{week.realizedTotal ? formatDurationShort(week.realizedTotal) : "—"}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {week.incomplete ? (
                      <p className="mt-1.5 text-muted">
                        {week.incomplete} séance{week.incomplete > 1 ? "s" : ""} sans durée calculable
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden className="mt-1.5 flex pl-11">
        {volumes.map((week, index) => (
          <span key={week.week} className={cn("figure flex-1 text-center text-[11px] text-muted", index % 2 === 1 && "max-sm:invisible", index === volumes.length - 1 && "font-semibold text-ink-soft")}>
            {shortDate(week.week)}
          </span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-soft">
        {present.map((sport) => (
          <li key={sport} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-[3px]", SPORT_FILL[sport])} />
            {SPORT_NAME[sport]}
          </li>
        ))}
        {showRealized ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-[2px] w-3.5 rounded-full bg-ink" />
            Réalisé (fichiers FIT)
          </li>
        ) : null}
      </ul>
    </div>
  );
}
