"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PriorityBadge } from "@/components/sport";
import { activityTitle } from "@/lib/activities/labels";
import type { ActivitySport } from "@/lib/activities/schema";
import type { FitnessData } from "@/lib/data/fitness";
import { startOfWeek } from "@/lib/planning/dates";
import { countsIn, FORM_ZONES, formOnRaceMorning, formZone, simulate, type FitnessPoint, type FormZoneKey, type LoadItem, type LoadMethod } from "@/lib/stats/fitness";
import { signed, ZONE_COLOR } from "@/lib/stats/fitness-format";
import { cn } from "@/lib/utils";

/** Largeur du repère SVG, étiré à la largeur réelle (traits d'épaisseur constante). */
const W = 1000;
const H_TOP = 200;
const H_FORM = 120;

const FITNESS_COLOR = "var(--chart-swim)";
const FATIGUE_COLOR = "var(--chart-strength)";
/** Fond des zones : plus marqué pour l'optimal et le risque de blessure. */
const ZONE_OPACITY: Record<FormZoneKey, number> = { recovery: 0.12, grey: 0.12, improve: 0.14, optimal: 0.2, risk: 0.18 };
/** Graduations de la forme : les limites des zones. */
const FORM_TICKS = [5, -10, -20, -30];

const PERIODS = [
  { days: 42, label: "6 sem." },
  { days: 91, label: "3 mois" },
  { days: 182, label: "6 mois" },
  { days: 365, label: "1 an" },
] as const;

const METHOD_LABELS: Record<LoadMethod, string> = {
  power: "puissance",
  pace: "allure moyenne",
  graded_pace: "allure normalisée, pente comprise",
  swim: "allure de nage",
  heart_rate: "fréquence cardiaque",
  rpe: "ressenti",
  plan: "d’après la séance prévue",
};

type Point = FitnessPoint & { afterPlan: boolean };

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const shortDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const weekdayDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

function niceTop(max: number): number {
  return [20, 40, 60, 80, 100, 120, 150, 200, 250].find((step) => step >= max * 1.08) ?? Math.ceil((max * 1.08) / 50) * 50;
}

const itemTitle = (item: LoadItem) => item.title || activityTitle({ name: null, sport: (["swim", "bike", "run", "strength"].includes(item.sport) ? item.sport : "other") as ActivitySport });

/**
 * Condition (42 j) et fatigue (7 j) en haut, forme et ses zones en bas. Le passé sur la période
 * choisie, puis la simulation : séances publiées par défaut, brouillons et retraits au choix,
 * recalculée aussitôt. Courses marquées, avec la forme prévue au départ.
 */
export function FitnessChart({ data }: { data: FitnessData }) {
  const [period, setPeriod] = useState<number>(91);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  const scenario = useMemo(() => ({ includeDrafts, excluded }), [includeDrafts, excluded]);
  const future = useMemo(() => simulate(data.model, scenario), [data.model, scenario]);
  const past = useMemo(() => data.history.slice(-period).map((p) => ({ ...p, afterPlan: false })), [data.history, period]);
  const points: Point[] = useMemo(() => [...past, ...future], [past, future]);
  const n = points.length;
  const drafts = data.model.planned.filter((i) => i.draft);
  const simulated = includeDrafts || excluded.size > 0;
  if (n < 2) return null;

  const todayIndex = past.length;
  const active = Math.min(hover ?? pinned ?? todayIndex, n - 1);
  const x = (i: number) => (i / (n - 1)) * W;
  const pct = (i: number) => `${(i / (n - 1)) * 100}%`;
  const top = niceTop(Math.max(10, ...points.map((p) => Math.max(p.fitness, p.fatigue))));
  const yTop = (v: number) => H_TOP - (Math.max(0, v) / top) * H_TOP;
  const formMax = Math.max(28, ...points.map((p) => p.form + 3));
  const formMin = Math.min(-40, ...points.map((p) => p.form - 3));
  const yForm = (v: number) => ((formMax - v) / (formMax - formMin)) * H_FORM;
  const lastActual = todayIndex - 1;
  const splitAt = Math.max(lastActual, 0);
  const firstRest = points.findIndex((p) => p.afterPlan);

  const path = (values: number[], y: (v: number) => number, from: number, to: number) =>
    to < from ? "" : values.slice(from, to + 1).map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = (values: number[], from: number, to: number) => (to < from ? "" : `${path(values, yTop, from, to)}L${x(to).toFixed(1)},${H_TOP}L${x(from).toFixed(1)},${H_TOP}Z`);
  const fitness = points.map((p) => p.fitness);
  const fatigue = points.map((p) => p.fatigue);
  const form = points.map((p) => p.form);
  const planEnd = firstRest > 0 ? firstRest - 1 : n - 1;

  // Forme : un tracé par suite de jours de même zone et de même nature (réel, prévision, repos supposé).
  const formRuns: { from: number; to: number; zone: FormZoneKey; kind: "actual" | "plan" | "rest" }[] = [];
  for (let i = 1; i < n; i += 1) {
    const zone = formZone(points[i].form).key;
    const kind = points[i].afterPlan ? "rest" : points[i].projected ? "plan" : "actual";
    const last = formRuns[formRuns.length - 1];
    if (last && last.zone === zone && last.kind === kind) last.to = i;
    else formRuns.push({ from: i - 1, to: i, zone, kind });
  }

  // Graduations du temps, autour d'aujourd'hui, plus espacées sur une longue période.
  const step = n <= 70 ? 7 : n <= 150 ? 14 : n <= 300 ? 28 : 56;
  const ticks = points.map((_, i) => i).filter((i) => (i - todayIndex) % step === 0 && i !== todayIndex);
  const races = data.races
    .map((race) => ({ ...race, index: points.findIndex((p) => p.date === race.date) }))
    .filter((race) => race.index >= 0);
  const point = points[active];
  const zone = formZone(point.form);
  const dayItems = point.date < data.today ? data.pastItems.filter((i) => i.date === point.date) : [];
  const dayPlanned = point.date >= data.today ? data.model.planned.filter((i) => i.date === point.date && (!i.draft || includeDrafts)) : [];
  const dayDone = point.date === data.today ? data.pastItems.filter((i) => i.date === data.today) : [];
  const dayRaces = races.filter((r) => r.date === point.date);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    return Math.round(ratio * (n - 1));
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
    setHover(null);
    setPinned((current) => Math.min(Math.max(move(current ?? todayIndex), 0), n - 1));
  };
  const toggle = (id: string, on: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  const reset = () => {
    setExcluded(new Set());
    setIncludeDrafts(false);
  };

  const valueText = `${longDate(point.date)} : condition ${Math.round(point.fitness)}, fatigue ${Math.round(point.fatigue)}, forme ${signed(point.form)}${point.projected ? ", prévision" : ""}${
    dayRaces.length ? `, course : ${dayRaces.map((r) => r.name).join(", ")}` : ""
  }`;
  const upcoming = data.model.planned.filter((i) => !i.draft || includeDrafts);
  const weeks = [...new Set(upcoming.map((i) => startOfWeek(i.date)))];
  const futureRaces = races.filter((r) => r.date > data.today);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Historique affiché" className="inline-flex rounded-[10px] border border-line bg-surface-2 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={period === p.days}
              onClick={() => {
                setPeriod(p.days);
                setPinned(null);
              }}
              className={cn(
                "h-8 rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
                period === p.days ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {simulated ? (
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-warning">
            Simulation : {[includeDrafts ? "brouillons inclus" : null, excluded.size ? `${excluded.size} séance${excluded.size > 1 ? "s" : ""} retirée${excluded.size > 1 ? "s" : ""}` : null].filter(Boolean).join(", ")}
            <button type="button" onClick={reset} className="rounded-[8px] border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-surface-2">
              Revenir au plan publié
            </button>
          </p>
        ) : null}
      </div>

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
              <path d={area(fitness, splitAt, planEnd)} fill={FITNESS_COLOR} opacity={0.06} />
              <path d={path(fitness, yTop, 0, splitAt)} fill="none" stroke={FITNESS_COLOR} strokeWidth={2.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <path d={path(fitness, yTop, splitAt, planEnd)} fill="none" stroke={FITNESS_COLOR} strokeWidth={2.25} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              {firstRest > 0 ? (
                <path d={path(fitness, yTop, planEnd, n - 1)} fill="none" stroke={FITNESS_COLOR} strokeWidth={1.5} strokeDasharray="2 4" opacity={0.6} vectorEffect="non-scaling-stroke" />
              ) : null}
              <path d={path(fatigue, yTop, 0, splitAt)} fill="none" stroke={FATIGUE_COLOR} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <path d={path(fatigue, yTop, splitAt, planEnd)} fill="none" stroke={FATIGUE_COLOR} strokeWidth={1.75} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              {firstRest > 0 ? (
                <path d={path(fatigue, yTop, planEnd, n - 1)} fill="none" stroke={FATIGUE_COLOR} strokeWidth={1.25} strokeDasharray="2 4" opacity={0.6} vectorEffect="non-scaling-stroke" />
              ) : null}
            </svg>
            {lastActual < n - 1 ? (
              <span aria-hidden className="absolute top-0 text-[10.5px] font-medium text-muted" style={{ left: `calc(${pct(splitAt)} + 6px)` }}>
                Prévision
              </span>
            ) : null}
            {firstRest > 0 ? (
              <span
                aria-hidden
                className={cn("absolute top-4 hidden whitespace-nowrap text-[10.5px] font-medium text-muted sm:block", firstRest / (n - 1) > 0.75 && "-translate-x-full")}
                style={{ left: firstRest / (n - 1) > 0.75 ? `calc(${pct(firstRest)} - 6px)` : `calc(${pct(firstRest)} + 6px)` }}
              >
                Sans séance prévue
              </span>
            ) : null}
          </div>

          {/* Forme et ses zones */}
          <div className="relative mt-3 h-36 sm:h-40">
            <svg aria-hidden viewBox={`0 0 ${W} ${H_FORM}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
              {FORM_ZONES.map((z, index) => {
                const upper = index === 0 ? formMax : FORM_ZONES[index - 1].min;
                const lower = Math.max(z.min, formMin);
                return <rect key={z.key} x={0} width={W} y={yForm(upper)} height={Math.max(0, yForm(lower) - yForm(upper))} fill={ZONE_COLOR[z.key]} opacity={ZONE_OPACITY[z.key]} />;
              })}
              {formRuns.map((run) => (
                <path
                  key={`${run.from}-${run.zone}-${run.kind}`}
                  d={path(form, yForm, run.from, run.to)}
                  fill="none"
                  stroke={ZONE_COLOR[run.zone]}
                  strokeWidth={run.kind === "rest" ? 1.5 : 2}
                  strokeDasharray={run.kind === "plan" ? "5 4" : run.kind === "rest" ? "2 4" : undefined}
                  opacity={run.kind === "rest" ? 0.6 : 1}
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
            {/* Nom de chaque zone, dans sa bande, à gauche */}
            {FORM_ZONES.map((z, index) => {
              const upper = index === 0 ? formMax : FORM_ZONES[index - 1].min;
              const lower = Math.max(z.min, formMin);
              const middle = (yForm(upper) + yForm(lower)) / 2;
              return (
                <span
                  key={z.key}
                  aria-hidden
                  className="pointer-events-none absolute left-1.5 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-[4px] bg-surface/85 px-1 text-[10.5px] font-semibold leading-tight text-ink-soft"
                  style={{ top: `${(middle / H_FORM) * 100}%` }}
                >
                  <span className="size-1.5 rounded-full" style={{ background: ZONE_COLOR[z.key] }} />
                  {z.label}
                </span>
              );
            })}
          </div>

          {/* Courses, aujourd'hui, et le jour pointé */}
          {races.map((race) => (
            <span key={race.id} aria-hidden className="absolute inset-y-0 w-px border-l border-dashed border-ink/50" style={{ left: `calc(2rem + (100% - 2rem) * ${race.index / (n - 1)})` }}>
              <span
                className={cn(
                  "figure absolute -top-2 left-1/2 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-[4px] bg-surface px-0.5 text-[10px] font-bold",
                  race.priority === "A" ? "bg-ink text-canvas" : race.priority === "B" ? "border border-ink/60 text-ink" : "border border-line-strong text-muted",
                )}
              >
                {race.priority}
              </span>
            </span>
          ))}
          <span aria-hidden className="absolute inset-y-0 w-px bg-ink/45" style={{ left: `calc(2rem + (100% - 2rem) * ${todayIndex / (n - 1)})` }} />
          <span aria-hidden className="absolute inset-y-0 w-px bg-ink" style={{ left: `calc(2rem + (100% - 2rem) * ${active / (n - 1)})` }} />

          <div
            ref={overlay}
            role="slider"
            tabIndex={0}
            aria-label="Condition physique jour par jour"
            aria-valuemin={0}
            aria-valuemax={n - 1}
            aria-valuenow={active}
            aria-valuetext={valueText}
            onPointerDown={(event) => {
              const i = pick(event);
              if (i !== null) {
                setPinned(i);
                setHover(null);
              }
            }}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse") setHover(pick(event));
            }}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            className="absolute inset-y-0 left-8 right-0 cursor-crosshair rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
            style={{ touchAction: "pan-y" }}
          />
        </div>

        <div aria-hidden className="relative ml-8 mt-1.5 h-4">
          {ticks.map((i) => (
            <span key={i} className="figure absolute -translate-x-1/2 whitespace-nowrap text-[10.5px] text-muted" style={{ left: pct(i) }}>
              {shortDate(points[i].date)}
            </span>
          ))}
          <span className="absolute -translate-x-1/2 text-[10.5px] font-semibold text-ink-soft" style={{ left: pct(todayIndex) }}>
            Auj.
          </span>
        </div>
      </div>

      <ul aria-label="Zones de forme" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
        {FORM_ZONES.map((z, index) => (
          <li key={z.key} className="flex items-center gap-1.5" title={z.hint}>
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: ZONE_COLOR[z.key] }} />
            <span className="font-semibold text-ink">{z.label}</span>
            <span className="figure text-muted">
              {index === 0 ? `au-dessus de ${signed(z.min)}` : index === FORM_ZONES.length - 1 ? `sous ${signed(FORM_ZONES[index - 1].min)}` : `de ${signed(z.min)} à ${signed(FORM_ZONES[index - 1].min)}`}
            </span>
          </li>
        ))}
      </ul>

      {/* Détail du jour pointé (aujourd'hui par défaut) */}
      <section aria-label="Détail du jour" aria-live="polite" className="rounded-[12px] border border-line p-3">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-[14px] font-semibold capitalize text-ink">
            {point.date === data.today ? "Aujourd’hui" : longDate(point.date)}
            {point.projected && point.date !== data.today ? <span className="ml-1.5 font-medium normal-case text-muted">prévision{point.afterPlan ? ", sans séance prévue" : ""}</span> : null}
          </span>
          <span className="figure text-[13px] text-ink-soft">
            Condition <strong className="text-ink">{Math.round(point.fitness)}</strong>, fatigue <strong className="text-ink">{Math.round(point.fatigue)}</strong>, forme{" "}
            <strong className="text-ink">{signed(point.form)}</strong>
            <span className="ml-1.5 inline-flex items-center gap-1 font-sans font-semibold">
              <span aria-hidden className="size-2 rounded-full" style={{ background: ZONE_COLOR[zone.key] }} />
              {zone.label}
            </span>
          </span>
        </p>
        {dayRaces.map((race) => (
          <p key={race.id} className="mt-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
            <PriorityBadge priority={race.priority} />
            {race.name}
          </p>
        ))}
        <ul className="mt-2 space-y-1 text-[13px]">
          {[...dayItems, ...dayDone].map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-ink">
                {itemTitle(item)} <span className="text-muted">({item.kind === "feedback" ? "retour de séance, " : ""}{METHOD_LABELS[item.method]})</span>
              </span>
              <span className="figure shrink-0 font-semibold text-ink">{Math.round(item.load)}</span>
            </li>
          ))}
          {dayPlanned.map((item) => {
            const on = countsIn(item, scenario);
            return (
              <li key={`plan-${item.id}`} className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={on} onChange={(event) => toggle(item.id, event.target.checked)} className="size-4 accent-[var(--ink)]" />
                  <span className={cn("min-w-0 truncate", on ? "text-ink" : "text-muted line-through")}>
                    {item.title} <span className="text-muted no-underline">(prévue{item.draft ? ", brouillon" : ""})</span>
                  </span>
                </label>
                <span className={cn("figure shrink-0 font-semibold", on ? "text-ink" : "text-muted")}>{Math.round(item.load)}</span>
              </li>
            );
          })}
          {!dayItems.length && !dayDone.length && !dayPlanned.length ? (
            <li className="text-muted">{point.date < data.today ? "Aucune charge comptée ce jour-là." : "Repos : aucune séance prévue."}</li>
          ) : null}
        </ul>
        <p className="mt-2 text-[12px] text-muted">Charge du jour : {Math.round(point.load)} (une heure au seuil vaut 100). Pointez un autre jour sur la courbe, au doigt ou au clavier.</p>
      </section>

      {futureRaces.length ? (
        <ul aria-label="Forme prévue au départ des courses" className="space-y-1.5">
          {futureRaces.map((race) => {
            const start = formOnRaceMorning(points, race.date);
            return (
              <li key={race.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                <PriorityBadge priority={race.priority} />
                <span className="font-semibold text-ink">{race.name}</span>
                <span className="text-muted">{weekdayDate(race.date)}</span>
                <span className="text-ink-soft">
                  {start === null ? (
                    "forme au départ : trop loin pour une prévision"
                  ) : (
                    <>
                      forme au départ <span className="figure font-semibold text-ink">{signed(start)}</span>, {formZone(start).label.toLowerCase()}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {upcoming.length || drafts.length ? (
        <details className="rounded-[12px] border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold text-ink-soft hover:text-ink">Simuler : choisir les séances comptées</summary>
          <div className="space-y-3 border-t border-line p-3">
            <p className="text-[12.5px] leading-snug text-muted">
              Décochez une séance pour voir la courbe sans elle ; rien n’est modifié dans le calendrier. Après la dernière séance comptée, la prévision suppose le repos.
            </p>
            {drafts.length ? (
              <label className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <input type="checkbox" checked={includeDrafts} onChange={(event) => setIncludeDrafts(event.target.checked)} className="size-4 accent-[var(--ink)]" />
                Compter aussi les {drafts.length} brouillon{drafts.length > 1 ? "s" : ""} (non publiés)
              </label>
            ) : null}
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {weeks.map((monday) => {
                const list = upcoming.filter((i) => startOfWeek(i.date) === monday);
                const total = list.filter((i) => countsIn(i, scenario)).reduce((sum, i) => sum + i.load, 0);
                return (
                  <fieldset key={monday}>
                    <legend className="flex w-full justify-between text-[12px] font-semibold text-muted">
                      <span>Semaine du {shortDate(monday)}</span>
                      <span className="figure">charge {Math.round(total)}</span>
                    </legend>
                    <ul className="mt-1 space-y-1">
                      {list.map((item) => {
                        const on = countsIn(item, scenario);
                        return (
                          <li key={item.id} className="flex items-center justify-between gap-3 text-[13px]">
                            <label className="flex min-w-0 items-center gap-2">
                              <input type="checkbox" checked={on} onChange={(event) => toggle(item.id, event.target.checked)} className="size-4 accent-[var(--ink)]" />
                              <span className="w-[5.5rem] shrink-0 text-muted first-letter:uppercase">{weekdayDate(item.date)}</span>
                              <span className={cn("min-w-0 truncate", on ? "text-ink" : "text-muted line-through")}>
                                {item.title}
                                {item.draft ? <span className="ml-1 text-muted no-underline">(brouillon)</span> : null}
                              </span>
                            </label>
                            <span className={cn("figure shrink-0", on ? "text-ink" : "text-muted")}>{Math.round(item.load)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
