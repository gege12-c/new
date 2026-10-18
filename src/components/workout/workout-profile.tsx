import { expandWorkout, intensityPercent, stepQuantities } from "@/lib/workout/compute";
import type { Workout } from "@/lib/workout/schema";
import { STEP_TYPE_LABELS } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { describeLength, describeTarget } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

/** Couleur d'une étape selon son intensité relative (% du seuil). */
function zoneClass(percent: number | null): string {
  if (percent === null) return "bg-rest/60";
  if (percent < 76) return "bg-zone-1";
  if (percent < 88) return "bg-zone-2";
  if (percent < 95) return "bg-zone-3";
  if (percent < 106) return "bg-zone-4";
  if (percent < 121) return "bg-zone-5";
  return "bg-zone-6";
}

/**
 * Profil d'une séance : largeur = durée, hauteur = intensité.
 * Une étape sans durée calculable reçoit une largeur minimale et une hachure, pour ne rien laisser croire.
 */
export function WorkoutProfile({
  workout,
  thresholds,
  className,
  height = 96,
}: {
  workout: Workout;
  thresholds?: AthleteThresholds;
  className?: string;
  height?: number;
}) {
  const flat = expandWorkout(workout).map((f) => {
    const q = stepQuantities(f.step, f.sport, thresholds);
    return { ...f, seconds: q.duration.value, percent: intensityPercent(f.step, f.sport, thresholds) };
  });
  const known = flat.reduce((sum, f) => sum + (f.seconds ?? 0), 0);
  const fallback = known > 0 ? known / Math.max(flat.length * 4, 1) : 60;

  return (
    <div className={cn("flex items-end gap-px", className)} style={{ height }} role="img" aria-label="Profil d'intensité de la séance">
      {flat.map((f, index) => {
        const seconds = f.seconds ?? fallback;
        const percent = f.percent;
        const ratio = percent === null ? 0.35 : Math.min(Math.max(percent / 130, 0.12), 1);
        const label = [
          STEP_TYPE_LABELS[f.step.type],
          describeLength(f.step.length, f.sport),
          f.step.targets[0] ? describeTarget(f.step.targets[0], f.sport) : null,
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={`${f.step.id}-${index}`}
            title={label}
            className={cn(
              "min-w-[2px] rounded-t-[2px]",
              zoneClass(percent),
              f.seconds === null && "bg-[repeating-linear-gradient(135deg,var(--rest)_0_3px,transparent_3px_6px)]",
            )}
            style={{ flexGrow: seconds, flexBasis: 0, height: `${ratio * 100}%` }}
          />
        );
      })}
    </div>
  );
}
