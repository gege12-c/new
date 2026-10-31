"use client";

import { useState } from "react";
import { SPORT_FILL, SPORT_NAME } from "@/lib/stats/labels";
import { STAT_SPORTS, type StatSport, type WeekVolume } from "@/lib/stats/stats";
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
const duration = (seconds: number) => (seconds ? formatDurationShort(seconds) : "—");

function Stack({ week, values, total, top }: { week: string; values: Record<StatSport, number>; total: number; top: number }) {
  const parts = STAT_SPORTS.filter((sport) => values[sport] > 0);
  return (
    <span className="flex w-full flex-col-reverse gap-[2px]" style={{ height: `${(total / top) * 100}%` }}>
      {parts.map((sport, i) => (
        <span key={`${week}-${sport}`} className={cn("w-full", SPORT_FILL[sport], i === parts.length - 1 && "rounded-t-[4px]")} style={{ flexGrow: values[sport], flexBasis: 0 }} />
      ))}
    </span>
  );
}

/**
 * Volume par semaine. Avec le réalisé : colonnes du fait (activités reçues, empilées par discipline)
 * et contour pointillé du prévu (séances publiées). Sans : colonnes du prévu, empilées.
 */
export function VolumeChart({ volumes, showRealized }: { volumes: WeekVolume[]; showRealized: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...volumes.map((v) => Math.max(v.plannedTotal, showRealized ? v.realizedTotal : 0)));
  const { top, ticks } = axis(max);
  const pct = (seconds: number) => `${(seconds / top) * 100}%`;
  const present = STAT_SPORTS.filter((sport) => volumes.some((v) => v.planned[sport] > 0 || (showRealized && v.realized[sport] > 0)));

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
            const label = `Semaine du ${dayMonth(week.week)} : ${showRealized ? `${week.realizedTotal ? `${formatDurationShort(week.realizedTotal)} faites` : "rien de fait"}, ` : ""}${
              week.plannedTotal ? `${formatDurationShort(week.plannedTotal)} prévues` : "rien de prévu"
            }`;
            const rows = STAT_SPORTS.filter((sport) => week.planned[sport] > 0 || (showRealized && week.realized[sport] > 0));
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
                  <span className={cn("relative flex h-full w-[min(24px,62%)] items-end transition-opacity", active !== null && active !== index && "opacity-55")}>
                    {showRealized ? (
                      <>
                        <Stack week={week.week} values={week.realized} total={week.realizedTotal} top={top} />
                        {week.plannedTotal > 0 ? (
                          <span aria-hidden className="absolute inset-x-[-3px] bottom-0 rounded-t-[5px] border-2 border-b-0 border-dashed border-ink-soft" style={{ height: pct(week.plannedTotal) }} />
                        ) : null}
                      </>
                    ) : (
                      <Stack week={week.week} values={week.planned} total={week.plannedTotal} top={top} />
                    )}
                  </span>
                </button>
                {active === index ? (
                  <div
                    role="tooltip"
                    className={cn(
                      "pointer-events-none absolute z-10 w-56 rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px] shadow-pop",
                      index < 3 ? "left-0" : index > volumes.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                    style={{ bottom: `calc(${pct(Math.max(week.plannedTotal, showRealized ? week.realizedTotal : 0))} + 10px)` }}
                  >
                    <p className="font-semibold text-ink">Semaine du {dayMonth(week.week)}</p>
                    <table className="mt-1.5 w-full">
                      <thead>
                        <tr className="text-[11.5px] text-muted">
                          <th scope="col" className="text-left font-normal">
                            <span className="sr-only">Discipline</span>
                          </th>
                          {showRealized ? (
                            <th scope="col" className="text-right font-normal">
                              Fait
                            </th>
                          ) : null}
                          <th scope="col" className="text-right font-normal">
                            Prévu
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((sport) => (
                          <tr key={sport}>
                            <th scope="row" className="py-0.5 text-left font-normal text-ink-soft">
                              <span className="flex items-center gap-1.5">
                                <span aria-hidden className={cn("size-2 rounded-[2px]", SPORT_FILL[sport])} />
                                {SPORT_NAME[sport]}
                              </span>
                            </th>
                            {showRealized ? <td className="figure py-0.5 text-right font-semibold text-ink">{duration(week.realized[sport])}</td> : null}
                            <td className="figure py-0.5 text-right text-ink-soft">{duration(week.planned[sport])}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-line">
                          <th scope="row" className="pt-1 text-left font-normal text-ink-soft">
                            Total
                          </th>
                          {showRealized ? <td className="figure pt-1 text-right font-semibold text-ink">{duration(week.realizedTotal)}</td> : null}
                          <td className="figure pt-1 text-right text-ink-soft">{duration(week.plannedTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
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
            <span aria-hidden className="h-3 w-3.5 rounded-t-[3px] border-2 border-b-0 border-dashed border-ink-soft" />
            Prévu (contour)
          </li>
        ) : null}
      </ul>
    </div>
  );
}
