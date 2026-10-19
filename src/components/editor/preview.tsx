import { AlertTriangle, Info } from "lucide-react";
import { SportDot } from "@/components/sport";
import { profileCaption, WorkoutProfile } from "@/components/workout/workout-profile";
import { computeTotals, type QuantityTotal } from "@/lib/workout/compute";
import { formatDistance, formatDuration, summarizeNodes } from "@/lib/workout/format";
import { SPORT_LABELS, type Workout } from "@/lib/workout/schema";
import type { WorkoutIssue } from "@/lib/workout/warnings";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";

function qualifier(total: QuantityTotal): string | null {
  switch (total.status) {
    case "exact":
      return null;
    case "estimated":
      return "estimée";
    case "partial":
      return `partielle : ${total.unknownSteps} étape${total.unknownSteps > 1 ? "s" : ""} sans valeur`;
    case "unknown":
      return "inconnue";
  }
}

function Figure({ label, total, format }: { label: string; total: QuantityTotal; format: (n: number) => string }) {
  const note = qualifier(total);
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold text-muted">{label}</dt>
      <dd className="figure mt-0.5 text-[30px] leading-none text-ink">{total.status === "unknown" || total.value === 0 ? "—" : format(total.value)}</dd>
      {note ? <dd className="mt-1 text-[12px] text-muted">{note}</dd> : null}
    </div>
  );
}

/** Aperçu en direct : profil d’intensité, totaux, alertes et résumé. Rien n’y est corrigé automatiquement. */
export function WorkoutPreview({
  workout,
  thresholds,
  issues,
  athleteName,
}: {
  workout: Workout;
  thresholds?: AthleteThresholds;
  issues: WorkoutIssue[];
  athleteName?: string;
}) {
  const totals = computeTotals(workout, thresholds);
  const multi = workout.segments.length > 1;
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");
  return (
    <div className="space-y-5">
      <div className="rounded-[14px] border border-line bg-surface p-4">
        <WorkoutProfile workout={workout} thresholds={thresholds} height={120} thresholdLine className="text-ink" />
        <div className="mt-2 flex justify-between gap-3 text-[11px] text-muted">
          <span>Début</span>
          <span className="text-right">{profileCaption(workout, thresholds, athleteName)}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <Figure label="Durée" total={totals.duration} format={formatDuration} />
          <Figure
            label="Distance"
            total={totals.distance}
            format={(m) => formatDistance(m, workout.segments.length === 1 ? workout.segments[0].sport : undefined)}
          />
        </dl>
        {multi ? (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
            {Object.entries(totals.bySport).map(([sport, value]) => (
              <li key={sport} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex items-center gap-2">
                  <SportDot sport={sport as keyof typeof SPORT_LABELS} />
                  {SPORT_LABELS[sport as keyof typeof SPORT_LABELS]}
                </span>
                <span className="figure flex gap-3 text-ink-soft">
                  <span>{value.durationSeconds ? formatDuration(value.durationSeconds) : "—"}</span>
                  {value.distanceMeters ? <span>{formatDistance(value.distanceMeters, sport as "swim")}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {warnings.length || infos.length ? (
        <section aria-label="Points d’attention" className="space-y-2">
          {[...warnings, ...infos].map((issue, index) => (
            <p
              key={`${issue.code}-${index}`}
              className={cn(
                "flex gap-2 rounded-[10px] px-3 py-2 text-[13px] leading-snug",
                issue.severity === "warning" ? "bg-warning-soft text-warning" : "bg-surface-2 text-ink-soft",
              )}
            >
              {issue.severity === "warning" ? <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden /> : <Info className="mt-px size-4 shrink-0" aria-hidden />}
              <span>{issue.message}</span>
            </p>
          ))}
        </section>
      ) : null}

      <section aria-label="Résumé" className="space-y-2">
        {workout.segments.map((segment) => (
          <p key={segment.id} className="text-[13px] leading-relaxed text-ink-soft">
            {multi ? <span className="font-semibold text-ink">{SPORT_LABELS[segment.sport]} : </span> : null}
            {summarizeNodes(segment.steps, segment.sport)}
          </p>
        ))}
      </section>
    </div>
  );
}
