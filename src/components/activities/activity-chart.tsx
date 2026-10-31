"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatElapsed as elapsed } from "@/lib/activities/format";
import type { ActivitySport } from "@/lib/activities/schema";
import type { ActivityLap, StreamMetric, StreamSeries } from "@/lib/activities/streams";
import { formatClock } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

/** Largeur du repère SVG, étiré à la largeur réelle (traits d'épaisseur constante). */
const W = 1000;
const H = 100;

interface Lane {
  metric: StreamMetric;
  label: string;
  color: string;
  values: (number | null)[];
  min: number;
  max: number;
  format: (value: number) => string;
  area?: boolean;
}

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function speedFormat(sport: ActivitySport): { label: string; format: (mps: number) => string } {
  if (sport === "run") return { label: "Allure", format: (v) => (v < 0.5 ? "arrêt" : `${formatClock(1000 / v)} /km`) };
  if (sport === "swim") return { label: "Allure", format: (v) => (v < 0.1 ? "arrêt" : `${formatClock(100 / v)} /100 m`) };
  return { label: "Vitesse", format: (v) => `${decimal.format(v * 3.6)} km/h` };
}

/** Bornes d'affichage : sans les valeurs extrêmes isolées (1 % de chaque côté). */
function bounds(values: (number | null)[], floorAtZero: boolean): { min: number; max: number } {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  let min = floorAtZero ? 0 : pick(0.01);
  let max = pick(0.99);
  if (max - min < 1e-6) {
    max += 1;
    min = floorAtZero ? 0 : min - 1;
  }
  const pad = (max - min) * 0.08;
  return { min: floorAtZero ? 0 : min - pad, max: max + pad };
}

function lanesFor(series: StreamSeries, sport: ActivitySport): Lane[] {
  const lanes: Lane[] = [];
  const add = (metric: StreamMetric, label: string, color: string, format: (v: number) => string, floorAtZero = false, area = false) => {
    const values = series[metric];
    if (!values?.some((v) => v !== null)) return;
    lanes.push({ metric, label, color, values, format, area, ...bounds(values, floorAtZero) });
  };
  add("watts", "Puissance", "var(--chart-bike)", (v) => `${Math.round(v)} W`, true, true);
  add("heartrate", "Fréquence cardiaque", "var(--chart-run)", (v) => `${Math.round(v)} bpm`);
  const speed = speedFormat(sport);
  add("speed", speed.label, "var(--chart-swim)", speed.format, true);
  // Cadence : à vélo seulement (en course, les appareils ne l'expriment pas tous dans la même unité).
  if (sport === "bike") add("cadence", "Cadence", "var(--chart-strength)", (v) => `${Math.round(v)} tr/min`, true);
  add("altitude", "Altitude", "var(--chart-other)", (v) => `${Math.round(v)} m`, false, true);
  return lanes;
}

/** Graduation du temps : « 15 min », « 1 h », « 1 h 30 ». */
function tickLabel(t: number): string {
  if (t < 3600) return `${Math.round(t / 60)} min`;
  const minutes = Math.round((t % 3600) / 60);
  return minutes ? `${Math.floor(t / 3600)} h ${String(minutes).padStart(2, "0")}` : `${Math.floor(t / 3600)} h`;
}

function timeTicks(duration: number): number[] {
  const step = [60, 300, 600, 900, 1200, 1800, 3600, 7200].find((s) => duration / s <= 6) ?? 7200;
  const ticks: number[] = [];
  for (let t = step; t < duration; t += step) ticks.push(t);
  return ticks;
}

/** Courbes de l'activité, une bande par mesure, sur le même axe du temps ; intervalles d'effort en fond. */
export function ActivityChart({ series, sport, laps }: { series: StreamSeries; sport: ActivitySport; laps: ActivityLap[] }) {
  const all = useMemo(() => lanesFor(series, sport), [series, sport]);
  const [hidden, setHidden] = useState<Set<StreamMetric>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const time = series.time;
  const n = time.length;
  const duration = time[n - 1] || 1;
  const lanes = all.filter((lane) => !hidden.has(lane.metric));
  if (!all.length || n < 2) return null;

  const x = (t: number) => (t / duration) * W;
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const work = laps.filter((lap) => lap.kind === "work");
  const separators = laps.some((lap) => lap.kind) ? [] : laps.slice(1).map((lap) => lap.start_s);

  const path = (lane: Lane) => {
    const y = (v: number) => H - ((v - lane.min) / (lane.max - lane.min)) * H;
    let d = "";
    let open = false;
    lane.values.forEach((v, i) => {
      if (v === null) {
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(time[i]).toFixed(1)},${Math.min(H, Math.max(0, y(v))).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const area = (lane: Lane) => {
    // Une aire par portion continue (une pause interrompt l'aire).
    const y = (v: number) => H - ((v - lane.min) / (lane.max - lane.min)) * H;
    const parts: string[] = [];
    let run: string[] = [];
    let first = 0;
    let last = 0;
    const close = () => {
      if (run.length > 1) parts.push(`M${x(time[first]).toFixed(1)},${H}${run.join("")}L${x(time[last]).toFixed(1)},${H}Z`);
      run = [];
    };
    lane.values.forEach((v, i) => {
      if (v === null) return close();
      if (!run.length) first = i;
      last = i;
      run.push(`L${x(time[i]).toFixed(1)},${Math.min(H, Math.max(0, y(v))).toFixed(1)}`);
    });
    close();
    return parts.join("");
  };

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    setActive(Math.round(ratio * (n - 1)));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.round(n / 20));
    const moves: Record<string, (i: number) => number> = {
      ArrowLeft: (i) => i - 1,
      ArrowRight: (i) => i + 1,
      PageUp: (i) => i - page,
      PageDown: (i) => i + page,
      Home: () => 0,
      End: () => n - 1,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setActive((current) => Math.min(Math.max(move(current ?? 0), 0), n - 1));
  };
  const at = active !== null ? time[active] : null;
  const readout = (lane: Lane) => {
    const v = active !== null ? lane.values[active] : null;
    return v === null || v === undefined ? "—" : lane.format(v);
  };
  const toggle = (metric: StreamMetric) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(metric)) next.delete(metric);
      else if (all.length - next.size > 1) next.add(metric);
      return next;
    });

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Courbes affichées" className="flex flex-wrap gap-1.5">
        {all.map((lane) => {
          const on = !hidden.has(lane.metric);
          return (
            <button
              key={lane.metric}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(lane.metric)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                on ? "border-line-strong bg-surface text-ink" : "border-line bg-surface-2 text-muted",
              )}
            >
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: on ? lane.color : "var(--line-strong)" }} />
              {lane.label}
            </button>
          );
        })}
      </div>

      <div className="relative select-none">
        {lanes.map((lane) => (
          <div key={lane.metric} className="relative border-t border-line pt-1 first:border-t-0 first:pt-0">
            <p aria-hidden className="pointer-events-none flex h-5 items-baseline gap-1.5 text-[11.5px] font-semibold text-ink-soft">
              {lane.label}
              <span className="figure font-semibold" style={{ color: lane.color }}>
                {active !== null ? readout(lane) : ""}
              </span>
            </p>
            <div className="relative h-14 sm:h-16">
              <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
                {work.map((lap) => (
                  <rect key={lap.start_s} x={x(lap.start_s)} width={Math.max(1, x(lap.duration_s))} y={0} height={H} fill="var(--ink)" opacity={0.06} />
                ))}
                {separators.map((t) => (
                  <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
                ))}
                {lane.area ? <path d={area(lane)} fill={lane.color} opacity={0.16} /> : null}
                <path d={path(lane)} fill="none" stroke={lane.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ))}

        {at !== null ? <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink" style={{ left: pct(at) }} /> : null}
        <div
          ref={overlay}
          role="slider"
          tabIndex={0}
          aria-label="Courbes de l’activité, minute par minute"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={active ?? 0}
          aria-valuetext={at !== null ? `${elapsed(at)} : ${lanes.map((lane) => `${lane.label.toLowerCase()} ${readout(lane)}`).join(", ")}` : "Déplacez-vous avec les flèches pour lire les valeurs."}
          onPointerDown={pick}
          onPointerMove={pick}
          onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
          onKeyDown={onKey}
          onFocus={() => setActive((current) => current ?? 0)}
          onBlur={() => setActive(null)}
          className="absolute inset-0 cursor-crosshair rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
          style={{ touchAction: "pan-y" }}
        />
        {at !== null ? (
          <span
            aria-hidden
            className={cn("figure pointer-events-none absolute -bottom-0.5 z-10 rounded-[6px] bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-canvas", at / duration > 0.85 ? "-translate-x-full" : "")}
            style={{ left: pct(at) }}
          >
            {elapsed(at)}
          </span>
        ) : null}
      </div>

      <div aria-hidden className="relative h-4">
        {timeTicks(duration).map((t) => (
          <span key={t} className="figure absolute -translate-x-1/2 text-[10.5px] text-muted" style={{ left: pct(t) }}>
            {tickLabel(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
