"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { FORM_ZONES, formZone, type FitnessPoint, type FormZoneKey } from "@/lib/stats/fitness";
import { signed, ZONE_COLOR } from "@/lib/stats/fitness-format";
import { cn } from "@/lib/utils";

/** Largeur du repère SVG, étiré à la largeur réelle (traits d'épaisseur constante). */
const W = 1000;
const H_TOP = 200;
const H_FORM = 120;

const FITNESS_COLOR = "var(--chart-swim)";
const FATIGUE_COLOR = "var(--chart-strength)";
const FORM_TICKS = [20, 5, -10, -30];

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
function niceTop(max: number): number {
  return [20, 40, 60, 80, 100, 120, 150, 200, 250].find((step) => step >= max * 1.08) ?? Math.ceil((max * 1.08) / 50) * 50;
}

/** Condition (42 j) et fatigue (7 j) en haut, forme et ses zones en bas ; la prévision en pointillés. */
export function FitnessChart({ points, today }: { points: FitnessPoint[]; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const n = points.length;
  if (n < 2) return null;

  const x = (i: number) => (i / (n - 1)) * W;
  const pct = (i: number) => `${(i / (n - 1)) * 100}%`;
  const top = niceTop(Math.max(10, ...points.map((p) => Math.max(p.fitness, p.fatigue))));
  const yTop = (v: number) => H_TOP - (Math.max(0, v) / top) * H_TOP;
  const formMax = Math.max(28, ...points.map((p) => p.form + 3));
  const formMin = Math.min(-40, ...points.map((p) => p.form - 3));
  const yForm = (v: number) => ((formMax - v) / (formMax - formMin)) * H_FORM;
  const todayIndex = points.findIndex((p) => p.date === today);
  const lastActual = points.findLastIndex((p) => !p.projected);
  const splitAt = Math.max(lastActual, 0);

  const path = (values: number[], y: (v: number) => number, from: number, to: number) =>
    to < from ? "" : values.slice(from, to + 1).map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = (values: number[], from: number, to: number) => (to < from ? "" : `${path(values, yTop, from, to)}L${x(to).toFixed(1)},${H_TOP}L${x(from).toFixed(1)},${H_TOP}Z`);
  const fitness = points.map((p) => p.fitness);
  const fatigue = points.map((p) => p.fatigue);
  const form = points.map((p) => p.form);

  // Forme : un tracé par suite de jours de même zone et de même nature (réel ou prévision).
  const formRuns: { from: number; to: number; zone: FormZoneKey; projected: boolean }[] = [];
  for (let i = 1; i < n; i += 1) {
    const zone = formZone(points[i].form).key;
    const projected = points[i].projected;
    const last = formRuns[formRuns.length - 1];
    if (last && last.zone === zone && last.projected === projected) last.to = i;
    else formRuns.push({ from: i - 1, to: i, zone, projected });
  }

  // Graduations du temps : toutes les deux semaines autour d'aujourd'hui.
  const anchor = todayIndex >= 0 ? todayIndex : lastActual;
  const ticks = points.map((_, i) => i).filter((i) => (i - anchor) % 14 === 0 && i !== anchor);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    setActive(Math.round(ratio * (n - 1)));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, (i: number) => number> = {
      ArrowLeft: (i) => i - 1,
      ArrowRight: (i) => i + 1,
      PageUp: (i) => i - 7,
      PageDown: (i) => i + 7,
      Home: () => 0,
      End: () => n - 1,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setActive((current) => Math.min(Math.max(move(current ?? anchor), 0), n - 1));
  };

  const point = active !== null ? points[active] : null;
  const zone = point ? formZone(point.form) : null;
  const summary =
    todayIndex >= 0
      ? `Aujourd’hui : condition ${Math.round(points[todayIndex].fitness)}, fatigue ${Math.round(points[todayIndex].fatigue)}, forme ${signed(points[todayIndex].form)} (${formZone(points[todayIndex].form).label.toLowerCase()}).`
      : "";

  return (
    <div className="select-none">
      <div className="relative pl-8">
        {/* Condition et fatigue */}
        <div className="relative h-44 sm:h-52">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <div key={f} aria-hidden className="absolute left-0 right-0 border-t border-line" style={{ top: `${(1 - f) * 100}%` }}>
              <span className="figure absolute -left-8 w-6 -translate-y-1/2 text-right text-[10.5px] text-muted">{Math.round(top * f)}</span>
            </div>
          ))}
          <svg aria-hidden viewBox={`0 0 ${W} ${H_TOP}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <path d={area(fitness, 0, splitAt)} fill={FITNESS_COLOR} opacity={0.14} />
            <path d={area(fitness, splitAt, n - 1)} fill={FITNESS_COLOR} opacity={0.06} />
            <path d={path(fitness, yTop, 0, splitAt)} fill="none" stroke={FITNESS_COLOR} strokeWidth={2.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={path(fitness, yTop, splitAt, n - 1)} fill="none" stroke={FITNESS_COLOR} strokeWidth={2.25} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <path d={path(fatigue, yTop, 0, splitAt)} fill="none" stroke={FATIGUE_COLOR} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={path(fatigue, yTop, splitAt, n - 1)} fill="none" stroke={FATIGUE_COLOR} strokeWidth={1.75} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          </svg>
          {lastActual < n - 1 ? (
            <span aria-hidden className="absolute top-0 text-[10.5px] font-medium text-muted" style={{ left: `calc(${pct(splitAt)} + 6px)` }}>
              Prévision
            </span>
          ) : null}
        </div>

        {/* Forme et ses zones */}
        <div className="relative mt-3 h-24 sm:h-28">
          <svg aria-hidden viewBox={`0 0 ${W} ${H_FORM}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {FORM_ZONES.map((z, index) => {
              const upper = index === 0 ? formMax : FORM_ZONES[index - 1].min;
              const lower = Math.max(z.min, formMin);
              return <rect key={z.key} x={0} width={W} y={yForm(upper)} height={Math.max(0, yForm(lower) - yForm(upper))} fill={ZONE_COLOR[z.key]} opacity={0.09} />;
            })}
            {formRuns.map((run) => (
              <path
                key={`${run.from}-${run.zone}`}
                d={path(form, yForm, run.from, run.to)}
                fill="none"
                stroke={ZONE_COLOR[run.zone]}
                strokeWidth={2}
                strokeDasharray={run.projected ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {FORM_TICKS.map((tick) => (
            <span key={tick} aria-hidden className="figure absolute -left-8 w-6 -translate-y-1/2 text-right text-[10.5px] text-muted" style={{ top: `${(yForm(tick) / H_FORM) * 100}%` }}>
              {signed(tick)}
            </span>
          ))}
        </div>

        {/* Aujourd'hui, et le jour pointé */}
        {todayIndex >= 0 ? <span aria-hidden className="absolute inset-y-0 w-px bg-ink/45" style={{ left: `calc(2rem + (100% - 2rem) * ${todayIndex / (n - 1)})` }} /> : null}
        {active !== null ? <span aria-hidden className="absolute inset-y-0 w-px bg-ink" style={{ left: `calc(2rem + (100% - 2rem) * ${active / (n - 1)})` }} /> : null}

        <div
          ref={overlay}
          role="slider"
          tabIndex={0}
          aria-label="Condition physique jour par jour"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={active ?? anchor}
          aria-valuetext={point ? `${longDate(point.date)} : condition ${Math.round(point.fitness)}, fatigue ${Math.round(point.fatigue)}, forme ${signed(point.form)}${point.projected ? ", prévision" : ""}` : summary}
          onPointerDown={pick}
          onPointerMove={pick}
          onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
          onKeyDown={onKey}
          onFocus={() => setActive((current) => current ?? anchor)}
          onBlur={() => setActive(null)}
          className="absolute inset-y-0 left-8 right-0 cursor-crosshair rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
          style={{ touchAction: "pan-y" }}
        />

        {point && zone ? (
          <div
            role="presentation"
            className={cn(
              "pointer-events-none absolute top-1 z-10 w-48 rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px] shadow-pop",
              active! / (n - 1) > 0.6 ? "-translate-x-full" : "",
            )}
            style={{ left: `calc(2rem + (100% - 2rem) * ${active! / (n - 1)} ${active! / (n - 1) > 0.6 ? "- 8px" : "+ 8px"})` }}
          >
            <p className="font-semibold capitalize text-ink">
              {longDate(point.date)}
              {point.projected ? <span className="ml-1.5 font-medium normal-case text-muted">prévision</span> : null}
            </p>
            <dl className="mt-1.5 space-y-1">
              <Row color={FITNESS_COLOR} label="Condition" value={String(Math.round(point.fitness))} />
              <Row color={FATIGUE_COLOR} label="Fatigue" value={String(Math.round(point.fatigue))} />
              <Row color={ZONE_COLOR[zone.key]} label="Forme" value={`${signed(point.form)} · ${zone.label}`} />
              <div className="flex items-center gap-2 border-t border-line pt-1">
                <dt className="flex-1 text-ink-soft">{point.projected ? "Charge prévue" : "Charge du jour"}</dt>
                <dd className="figure font-semibold text-ink">{point.load ? Math.round(point.load) : point.projected ? "repos" : "aucune"}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>

      <div aria-hidden className="relative ml-8 mt-1.5 h-4">
        {ticks.map((i) => (
          <span key={i} className="figure absolute -translate-x-1/2 text-[10.5px] text-muted" style={{ left: pct(i) }}>
            {shortDate(points[i].date)}
          </span>
        ))}
        {anchor >= 0 ? (
          <span className="absolute -translate-x-1/2 text-[10.5px] font-semibold text-ink-soft" style={{ left: pct(anchor) }}>
            Auj.
          </span>
        ) : null}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-soft">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-[3px] w-3.5 rounded-full" style={{ background: FITNESS_COLOR }} />
          Condition (42 jours)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-[3px] w-3.5 rounded-full" style={{ background: FATIGUE_COLOR }} />
          Fatigue (7 jours)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t-2 border-dashed border-ink-soft" />
          Prévision d’après les séances prévues
        </li>
      </ul>
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="h-[3px] w-3 rounded-full" style={{ background: color }} />
      <dt className="flex-1 text-ink-soft">{label}</dt>
      <dd className="figure font-semibold text-ink">{value}</dd>
    </div>
  );
}
