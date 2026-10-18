import type { CSSProperties } from "react";
import { expandWorkout, intensityPercent, stepQuantities } from "@/lib/workout/compute";
import { describeLength, describeTarget } from "@/lib/workout/format";
import type { Workout } from "@/lib/workout/schema";
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
  unknownLength: boolean;
  label: string;
}

/** Barres du profil : largeur = durée, hauteur = intensité. Partagé par le profil et ses variantes. */
export function profileBars(workout: Workout, thresholds?: AthleteThresholds): ProfileBar[] {
  const flat = expandWorkout(workout).map((f) => {
    const q = stepQuantities(f.step, f.sport, thresholds);
    return { ...f, seconds: q.duration.value, percent: intensityPercent(f.step, f.sport, thresholds) };
  });
  const known = flat.reduce((sum, f) => sum + (f.seconds ?? 0), 0);
  const fallback = known > 0 ? known / Math.max(flat.length * 4, 1) : 60;
  return flat.map((f, index) => ({
    key: `${f.step.id}-${index}`,
    grow: f.seconds ?? fallback,
    ratio: f.percent === null ? 0.32 : Math.min(Math.max(f.percent / CEILING, 0.1), 1),
    percent: f.percent,
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
  return (
    <div className={cn("relative", className)} style={{ height }}>
      {thresholdLine ? (
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
              zoneClass(bar.percent),
              bar.unknownLength && "bg-[repeating-linear-gradient(135deg,var(--other)_0_3px,transparent_3px_6px)]",
            )}
            style={{ flexGrow: bar.grow, flexBasis: 0, height: `${bar.ratio * 100}%`, "--i": index } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
