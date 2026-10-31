"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { addThreshold } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/feedback";
import { CURVE_DURATIONS, PACE_DISTANCES, POWER_BEST_DURATIONS, type PaceSport } from "@/lib/activities/streams";
import { idle, type ActionState } from "@/lib/action-state";
import type { FtpEstimate, PaceEstimate } from "@/lib/stats/estimates";
import { POWER_PERIODS, type PaceCurve, type PowerCurve, type PowerPeriodKey } from "@/lib/stats/power";
import { formatClock, formatDuration } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

type Tab = "bike" | "run" | "swim";

const TAB_LABELS: Record<Tab, string> = { bike: "Vélo, puissance", run: "Course, allure", swim: "Natation, allure" };
const COLORS: Record<Tab, string> = { bike: "var(--chart-bike)", run: "var(--chart-run)", swim: "var(--chart-swim)" };

const durationLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`.replace(".", ","));
const DISTANCE_LABELS: Record<number, string> = { 1609: "1 mile", 21097: "Semi", 42195: "Marathon", 1900: "1,9 km", 3800: "3,8 km", 750: "750 m" };
const distanceLabel = (m: number) => DISTANCE_LABELS[m] ?? (m >= 1000 ? `${m / 1000} km`.replace(".", ",") : `${m} m`);
const dayMonth = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
/** Temps d'une distance : « 3:52 » sous l'heure, « 1:42:10 » au-delà. */
const raceTime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${formatClock(Math.round(s % 3600)).padStart(5, "0")}` : formatClock(Math.round(s)));
const paceOf = (sport: PaceSport, distance: number, seconds: number) => (sport === "run" ? `${formatClock(Math.round((seconds / distance) * 1000))} /km` : `${formatClock(Math.round((seconds / distance) * 100))} /100 m`);

/** Largeur mesurée du conteneur : le graphique garde des textes lisibles sur téléphone. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Series {
  key: PowerPeriodKey;
  label: string;
  points: { x: number; y: number }[];
}

const H = 210;
const PAD = { left: 46, right: 10, top: 10, bottom: 26 };

/** Courbe de records : abscisse logarithmique (durée ou distance), une ligne par période. */
/** Graduations « rondes » : pas de 1, 2, 2,5 ou 5 × 10^n, trois à cinq lignes. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const range = max - min || 1;
  const power = 10 ** Math.floor(Math.log10(range / count));
  const step = [1, 2, 2.5, 5, 10, 20].map((m) => m * power).find((s) => range / s <= count + 1) ?? range;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function CurveChart({
  series,
  ticks,
  color,
  gridY,
  formatY,
  label,
}: {
  series: Series[];
  ticks: { x: number; label: string }[];
  color: string;
  /** Lignes horizontales (en unités de l'ordonnée) d'après les bornes des données. */
  gridY: (min: number, max: number) => number[];
  formatY: (y: number) => string;
  label: string;
}) {
  const [ref, width] = useWidth();
  const all = series.flatMap((s) => s.points);
  return (
    <div ref={ref} className="h-[210px] w-full">
      {width > 0 && all.length ? (
        (() => {
          const xs = all.map((p) => Math.log10(p.x));
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          // Graduations dans l'étendue des records seulement (pas de marathon sans marathon).
          const shownTicks = ticks.filter((t) => Math.log10(t.x) >= minX - 0.05 && Math.log10(t.x) <= maxX + 0.05);
          const ys = all.map((p) => p.y);
          const span = Math.max(...ys) - Math.min(...ys) || Math.max(...ys) * 0.2 || 1;
          const minY = Math.max(0, Math.min(...ys) - span * 0.12);
          const maxY = Math.max(...ys) + span * 0.08;
          const x = (v: number) => PAD.left + ((Math.log10(v) - minX) / (maxX - minX || 1)) * (width - PAD.left - PAD.right);
          const y = (v: number) => PAD.top + (1 - (v - minY) / (maxY - minY || 1)) * (H - PAD.top - PAD.bottom);
          const lines = gridY(minY, maxY).filter((v) => v >= minY && v <= maxY);
          return (
            <svg width={width} height={H} role="img" aria-label={label} className="overflow-visible">
              {lines.map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                  <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                    {formatY(v)}
                  </text>
                </g>
              ))}
              {shownTicks.map((t) => (
                <text key={t.x} x={x(t.x)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">
                  {t.label}
                </text>
              ))}
              {series.map((s, index) => {
                const path = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
                const faded = index > 0;
                return (
                  <g key={s.key} opacity={faded ? 0.45 : 1}>
                    <path d={path} fill="none" stroke={color} strokeWidth={faded ? 1.5 : 2.2} strokeDasharray={faded ? "5 4" : undefined} strokeLinejoin="round" />
                    {s.points.map((p) => (
                      <circle key={p.x} cx={x(p.x)} cy={y(p.y)} r={faded ? 2 : 2.8} fill={color} />
                    ))}
                  </g>
                );
              })}
            </svg>
          );
        })()
      ) : null}
    </div>
  );
}

function Legend({ series, color }: { series: Series[]; color: string }) {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
      {series.map((s, index) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" x2="18" y1="3" y2="3" stroke={color} strokeWidth={index ? 1.5 : 2.2} strokeDasharray={index ? "4 3" : undefined} opacity={index ? 0.45 : 1} />
          </svg>
          {s.label}
        </span>
      ))}
    </p>
  );
}

/** Enregistre un seuil estimé, à partir d'aujourd'hui (historique gardé). */
function ApplyEstimate({ athleteId, today, thresholdKey, value, notes, label }: { athleteId: string; today: string; thresholdKey: string; value: string; notes: string; label: string }) {
  const [state, action, pending] = useActionState(async (previous: ActionState, formData: FormData) => addThreshold(previous, formData), idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="athlete_id" value={athleteId} />
      <input type="hidden" name="key" value={thresholdKey} />
      <input type="hidden" name="value" value={value} />
      <input type="hidden" name="effective_from" value={today} />
      <input type="hidden" name="notes" value={notes} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Enregistrement…" : label}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

function EstimateCard({ title, value, basis, current, delta, apply }: { title: string; value: string; basis: string; current: string | null; delta: string | null; apply: React.ReactNode }) {
  return (
    <div className="rounded-[12px] bg-surface-2 p-3">
      <p className="text-[13px] font-semibold text-ink-soft">{title}</p>
      <p className="figure mt-0.5 text-[24px] leading-tight text-ink">{value}</p>
      <p className="mt-1 text-[13px] leading-snug text-muted">{basis}</p>
      {current ? (
        <p className="mt-1 text-[13px] text-ink-soft">
          Seuil enregistré : <span className="figure font-semibold text-ink">{current}</span>
          {delta ? <span className="text-muted"> ({delta})</span> : null}
        </p>
      ) : null}
      {apply ? <div className="mt-2">{apply}</div> : null}
    </div>
  );
}

/**
 * Records de la saison et seuils estimés : courbe de puissance à vélo, meilleurs temps par distance
 * en course et en natation, sur 3 et 12 mois ; FTP et allure seuil estimées, enregistrables en un geste.
 */
export function RecordsPanel({
  power,
  run,
  swim,
  estimates,
  athleteId,
  today,
  calendarBase,
  canApply,
}: {
  power: PowerCurve;
  run: PaceCurve;
  swim: PaceCurve;
  estimates: { ftp: FtpEstimate | null; pace: PaceEstimate | null; currentFtp: number | null; currentPace: number | null };
  athleteId: string;
  today: string;
  /** Calendrier où ouvrir l'activité d'un record (athlète : le sien ; coach : celui de l'athlète). */
  calendarBase: string;
  canApply: boolean;
}) {
  const activityHref = (date: string, activityId: string) => `${calendarBase}?view=day&date=${date}&activity=${activityId}`;
  const available: Tab[] = (["bike", "run", "swim"] as const).filter((t) => (t === "bike" ? power.activities : t === "run" ? run.activities : swim.activities) > 0);
  const [tab, setTab] = useState<Tab>(available[0] ?? "bike");
  if (!available.length) return null;
  const color = COLORS[tab];
  const periods = POWER_PERIODS.filter((p) => p.key !== "42");

  let chart: React.ReactNode;
  let table: React.ReactNode;
  let estimate: React.ReactNode = null;
  if (tab === "bike") {
    const series: Series[] = periods.map((p) => ({
      key: p.key,
      label: p.label,
      points: CURVE_DURATIONS.flatMap((d) => (power.bests[d][p.key] ? [{ x: d, y: power.bests[d][p.key]!.watts }] : [])),
    }));
    const main = series[0].points.length ? series[0] : series[1];
    chart = (
      <>
        <CurveChart
          series={series}
          color={color}
          gridY={(min, max) => niceTicks(min, max)}
          formatY={(w) => `${Math.round(w)} W`}
          ticks={[5, 60, 300, 1200, 3600, 7200].map((d) => ({ x: d, label: durationLabel(d) }))}
          label={`Courbe de puissance (${main.label}) : ${main.points.map((p) => `${durationLabel(p.x)} ${p.y} W`).join(", ")}`}
        />
        <Legend series={series} color={color} />
      </>
    );
    table = (
      <RecordTable
        rows={POWER_BEST_DURATIONS.map((d) => ({ key: d, label: durationLabel(d), cells: POWER_PERIODS.map((p) => power.bests[d][p.key] ?? null).map((e) => (e ? { value: `${e.watts} W`, date: e.date, activityId: e.activityId } : null)) }))}
        activityHref={activityHref}
      />
    );
    if (estimates.ftp) {
      const { watts, basis } = estimates.ftp;
      const same = estimates.currentFtp !== null && Math.abs(estimates.currentFtp - watts) < 1;
      estimate = (
        <EstimateCard
          title="FTP estimée"
          value={`${watts} W`}
          basis={
            basis.duration === 1200
              ? `95 % de votre meilleure puissance sur 20 min ces 3 derniers mois (${basis.watts} W, le ${dayMonth(basis.date)}).`
              : `Votre meilleure heure ces 3 derniers mois (${basis.watts} W, le ${dayMonth(basis.date)}).`
          }
          current={estimates.currentFtp !== null ? `${estimates.currentFtp} W` : null}
          delta={estimates.currentFtp !== null && !same ? `${watts > estimates.currentFtp ? "+" : "−"}${Math.abs(Math.round(watts - estimates.currentFtp))} W pour l’estimation` : same ? "identique" : null}
          apply={
            canApply && !same ? (
              <ApplyEstimate athleteId={athleteId} today={today} thresholdKey="bike.ftp_w" value={String(watts)} notes="Estimée d’après les records de la saison" label={`Enregistrer ${watts} W comme FTP`} />
            ) : null
          }
        />
      );
    }
  } else {
    const curve = tab === "run" ? run : swim;
    const sport = curve.sport;
    const distances = PACE_DISTANCES[sport];
    const series: Series[] = periods.map((p) => ({
      key: p.key,
      label: p.label,
      points: distances.flatMap((d) => (curve.bests[d]?.[p.key] ? [{ x: d, y: d / curve.bests[d][p.key]!.seconds }] : [])),
    }));
    const main = series[0].points.length ? series[0] : series[1];
    const formatSpeed = (speed: number) => (sport === "run" ? formatClock(Math.round(1000 / speed)) : formatClock(Math.round(100 / speed)));
    chart = (
      <>
        <CurveChart
          series={series}
          color={color}
          gridY={(min, max) => {
            // Allures rondes (pas de 5, 10, 15, 30 s…) converties en vitesse.
            const unit = sport === "run" ? 1000 : 100;
            const slow = unit / min;
            const fast = unit / max;
            const step = [5, 10, 15, 20, 30, 60].find((s) => (slow - fast) / s <= 4) ?? 60;
            const out: number[] = [];
            for (let pace = Math.ceil(fast / step) * step; pace <= slow; pace += step) out.push(unit / pace);
            return out;
          }}
          formatY={formatSpeed}
          ticks={(sport === "run" ? [400, 1000, 5000, 10000, 21097, 42195] : [50, 100, 400, 1000, 1900, 3800]).map((d) => ({ x: d, label: distanceLabel(d) }))}
          label={`Meilleure allure par distance (${main.label}) : ${main.points.map((p) => `${distanceLabel(p.x)} ${formatSpeed(p.y)}`).join(", ")}`}
        />
        <Legend series={series} color={color} />
        <p className="text-[12px] text-muted">Allure moyenne du meilleur temps de chaque distance, {sport === "run" ? "par kilomètre" : "aux 100 m"} : plus haut, plus rapide.</p>
      </>
    );
    const shown = sport === "run" ? [400, 1000, 5000, 10000, 21097, 42195] : [100, 400, 1000, 1500, 1900, 3800];
    table = (
      <RecordTable
        rows={shown
          .filter((d) => POWER_PERIODS.some((p) => curve.bests[d]?.[p.key]))
          .map((d) => ({
            key: d,
            label: distanceLabel(d),
            cells: POWER_PERIODS.map((p) => curve.bests[d]?.[p.key] ?? null).map((e) => (e ? { value: raceTime(e.seconds), sub: paceOf(sport, d, e.seconds), date: e.date, activityId: e.activityId } : null)),
          }))}
        activityHref={activityHref}
      />
    );
    if (sport === "run" && estimates.pace) {
      const { secondsPerKm, basis } = estimates.pace;
      const same = estimates.currentPace !== null && Math.abs(estimates.currentPace - secondsPerKm) < 1;
      estimate = (
        <EstimateCard
          title="Allure seuil estimée"
          value={`${formatClock(secondsPerKm)} /km`}
          basis={`D’après votre meilleur ${distanceLabel(basis.distance)} ces 3 derniers mois (${raceTime(basis.seconds)}, le ${dayMonth(basis.date)}), ramené à une heure d’effort.`}
          current={estimates.currentPace !== null ? `${formatClock(estimates.currentPace)} /km` : null}
          delta={
            estimates.currentPace !== null && !same
              ? `${secondsPerKm < estimates.currentPace ? "plus rapide de " : "plus lente de "}${formatDuration(Math.abs(estimates.currentPace - secondsPerKm))} au km pour l’estimation`
              : same
                ? "identique"
                : null
          }
          apply={
            canApply && !same ? (
              <ApplyEstimate
                athleteId={athleteId}
                today={today}
                thresholdKey="run.threshold_pace_s_per_km"
                value={formatClock(secondsPerKm)}
                notes="Estimée d’après les records de la saison"
                label={`Enregistrer ${formatClock(secondsPerKm)} /km comme allure seuil`}
              />
            ) : null
          }
        />
      );
    }
  }

  return (
    <div className="space-y-4">
      {available.length > 1 ? (
        <div role="tablist" aria-label="Discipline" className="flex flex-wrap gap-2">
          {available.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "h-9 rounded-full border px-3.5 text-[13.5px] transition-colors",
                tab === t ? "border-ink bg-surface-2 font-semibold text-ink" : "border-line-strong text-ink-soft hover:border-ink/40",
              )}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" aria-label={TAB_LABELS[tab]} className="space-y-4">
        {estimate}
        <div className="space-y-1.5">{chart}</div>
        {table}
      </div>
      <p className="text-[12px] leading-snug text-muted">
        Records faits à l’entraînement, pas forcément à fond : une estimation peut être prudente. Les courbes de l’année se lisent peu à peu après la liaison avec intervals.icu.
      </p>
    </div>
  );
}

function RecordTable({
  rows,
  activityHref,
}: {
  rows: { key: number; label: string; cells: ({ value: string; sub?: string; date: string; activityId: string } | null)[] }[];
  activityHref: (date: string, activityId: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-left text-[13.5px]">
        <thead>
          <tr className="text-[12px] text-muted">
            <th scope="col" className="pb-1.5 pr-3 font-medium">
              Record
            </th>
            {POWER_PERIODS.map((period) => (
              <th key={period.key} scope="col" className="pb-1.5 pr-3 font-medium">
                {period.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="py-2 pr-3 font-semibold text-ink-soft">
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className="py-2 pr-3 align-top">
                  {cell ? (
                    <>
                      <span className="figure block font-semibold text-ink">{cell.value}</span>
                      {cell.sub ? <span className="figure block text-[12px] text-ink-soft">{cell.sub}</span> : null}
                      <Link href={activityHref(cell.date, cell.activityId)} className="figure block text-[12px] text-muted underline decoration-line-strong underline-offset-2 hover:text-ink">
                        {dayMonth(cell.date)}
                      </Link>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
