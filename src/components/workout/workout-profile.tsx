import type { CSSProperties } from "react";
import { expandWorkout, intensityPercent, stepQuantities } from "@/lib/workout/compute";
import { describeLength, describeTarget } from "@/lib/workout/format";
import type { Step, Workout } from "@/lib/workout/schema";
import { STEP_TYPE_LABELS } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";

/** Plafond de l’échelle verticale, en % du seuil : au-delà, la barre est pleine. */
const CEILING = 130;

/** Couleur d’une étape selon son intensité relative (% du seuil), bornes des zones de Coggan. */
export function zoneClass(percent: number | null): string {
  if (percent === null) return "bg-other/45";
  if (percent < 56) return "bg-zone-1";
  if (percent < 76) return "bg-zone-2";
  if (percent < 91) return "bg-zone-3";
  if (percent < 106) return "bg-zone-4";
  if (percent < 121) return "bg-zone-5";
  return "bg-zone-6";
}

export interface ProfileBar {
  key: string;
  grow: number;
  ratio: number;
  percent: number | null;
  /** Hauteur comparée aux autres étapes de la séance (cible en W, bpm ou allure sans le seuil correspondant). */
  relative: boolean;
  unknownLength: boolean;
  label: string;
}

/** Couleur d’une barre : sa zone si l’intensité est connue, sinon neutre (plus soutenue si sa hauteur est comparée). */
export function barClass(bar: Pick<ProfileBar, "percent" | "relative">): string {
  if (bar.percent !== null) return zoneClass(bar.percent);
  return bar.relative ? "bg-other/80" : "bg-other/45";
}

/** Hauteur maximale d’une barre comparée, pour la distinguer d’une intensité connue. */
const RELATIVE_TOP = 0.85;

/**
 * Intensité comparable entre étapes d’une même séance quand le seuil manque : la cible elle-même
 * (W, bpm, km/h ; pour une allure, la vitesse). Plus grand veut dire plus intense.
 */
function absoluteIntensity(step: Step): { key: string; value: number } | null {
  for (const target of step.targets) {
    const key = `${target.metric}.${target.unit}`;
    const mid = (target.min + target.max) / 2;
    if (mid <= 0) continue;
    if (key === "power.watts" || key === "heart_rate.bpm" || key === "speed.kmh") return { key, value: mid };
    if (key === "pace.sec_per_km" || key === "pace.sec_per_100m") return { key, value: 1 / mid };
  }
  return null;
}

/** Barres du profil : largeur = durée, hauteur = intensité. Partagé par le profil et ses variantes. */
export function profileBars(workout: Workout, thresholds?: AthleteThresholds): ProfileBar[] {
  const flat = expandWorkout(workout).map((f) => {
    const q = stepQuantities(f.step, f.sport, thresholds);
    const percent = intensityPercent(f.step, f.sport, thresholds);
    return { ...f, seconds: q.duration.value, percent, absolute: percent === null ? absoluteIntensity(f.step) : null };
  });
  const strongest = new Map<string, number>();
  for (const f of flat) if (f.absolute) strongest.set(f.absolute.key, Math.max(strongest.get(f.absolute.key) ?? 0, f.absolute.value));
  const known = flat.reduce((sum, f) => sum + (f.seconds ?? 0), 0);
  const fallback = known > 0 ? known / Math.max(flat.length * 4, 1) : 60;
  return flat.map((f, index) => ({
    key: `${f.step.id}-${index}`,
    grow: f.seconds ?? fallback,
    ratio:
      f.percent !== null
        ? Math.min(Math.max(f.percent / CEILING, 0.1), 1)
        : f.absolute
          ? Math.max((f.absolute.value / (strongest.get(f.absolute.key) ?? f.absolute.value)) * RELATIVE_TOP, 0.12)
          : 0.32,
    percent: f.percent,
    relative: f.percent === null && f.absolute !== null,
    unknownLength: f.seconds === null,
    label: [
      STEP_TYPE_LABELS[f.step.type],
      describeLength(f.step.length, f.sport),
      f.step.targets[0] ? describeTarget(f.step.targets[0], f.sport) : null,
    ]
      .filter(Boolean)
      .join(", "),
  }));
}

/**
 * Profil d’une séance. Une étape sans durée calculable reçoit une largeur conventionnelle
 * et une hachure, pour ne rien laisser croire.
 */
export function WorkoutProfile({
  workout,
  thresholds,
  className,
  height = 96,
  animate = false,
  thresholdLine = false,
  compact = false,
}: {
  workout: Workout;
  thresholds?: AthleteThresholds;
  className?: string;
  height?: number;
  animate?: boolean;
  thresholdLine?: boolean;
  compact?: boolean;
}) {
  const bars = profileBars(workout, thresholds);
  // Le pointillé du seuil n’a de sens que si les hauteurs lui sont toutes rapportées (aucune étape seulement comparée).
  const showThreshold = thresholdLine && bars.some((bar) => bar.percent !== null) && !bars.some((bar) => bar.relative);
  return (
    <div className={cn("relative", className)} style={{ height }}>
      {showThreshold ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-current opacity-25"
          style={{ bottom: `${(100 / CEILING) * 100}%` }}
        />
      ) : null}
      <div
        className={cn("flex h-full items-end", compact ? "gap-[1px]" : "gap-[2px]", animate && "rise-in")}
        role="img"
        aria-label="Profil d’intensité de la séance"
      >
        {bars.map((bar, index) => (
          <div
            key={bar.key}
            title={compact ? undefined : bar.label}
            className={cn(
              compact ? "min-w-[1.5px] rounded-t-[1px]" : "min-w-[3px] rounded-t-[3px]",
              barClass(bar),
              bar.unknownLength && "bg-[repeating-linear-gradient(135deg,var(--other)_0_3px,transparent_3px_6px)]",
            )}
            style={{ flexGrow: bar.grow, flexBasis: 0, height: `${bar.ratio * 100}%`, "--i": index } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Échelle du profil : rapportée au seuil, seulement comparée entre étapes faute de seuil, les deux
 * mêlées (une étape en % FTP, une autre en W sans FTP), ou aucune.
 */
export function profileScale(workout: Workout, thresholds?: AthleteThresholds): "threshold" | "relative" | "mixed" | "none" {
  const bars = profileBars(workout, thresholds);
  const anchored = bars.some((bar) => bar.percent !== null);
  const compared = bars.some((bar) => bar.relative);
  if (anchored && compared) return "mixed";
  if (anchored) return "threshold";
  return compared ? "relative" : "none";
}

/** Note sous un profil dont des hauteurs sont seulement comparées faute de seuil, ou null. */
export function relativeProfileNote(workout: Workout, thresholds?: AthleteThresholds): string | null {
  const scale = profileScale(workout, thresholds);
  if (scale === "relative") return "Seuil non renseigné : hauteurs comparées entre étapes, sans zones";
  if (scale === "mixed") return "Seuil non renseigné : les étapes grises sont comparées entre elles, sans zone";
  return null;
}

/** Légende du profil : seuil en pointillés, ou hauteurs seulement comparées faute de seuil. */
export function profileCaption(workout: Workout, thresholds: AthleteThresholds | undefined, athleteName?: string): string | null {
  const note = relativeProfileNote(workout, thresholds);
  if (note) return note;
  return profileScale(workout, thresholds) === "threshold" ? `Pointillés : seuil${athleteName ? ` de ${athleteName}` : ""}` : null;
}
