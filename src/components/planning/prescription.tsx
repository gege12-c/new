import { Repeat2 } from "lucide-react";
import { SportDot } from "@/components/sport";
import { zoneClass } from "@/components/workout/workout-profile";
import { intensityPercent, resolveTarget } from "@/lib/workout/compute";
import { describeLength, describeTarget, formatClock } from "@/lib/workout/format";
import { EQUIPMENT_LABELS, SPORT_LABELS, STEP_TYPE_LABELS, type SegmentSport, type Step, type Target, type Workout, type WorkoutNode } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";

/** Cible exprimée d’abord en valeur absolue pour l’athlète (« 217–228 W »), puis telle que prescrite. */
function TargetText({ target, sport, thresholds }: { target: Target; sport: SegmentSport; thresholds?: AthleteThresholds }) {
  const prescribed = describeTarget(target, sport);
  const resolution = resolveTarget(target, sport, thresholds);
  let absolute: string | null = null;
  if (resolution.ok) {
    const t = resolution.target;
    const range = (min: number, max: number, f: (n: number) => string) => (min === max ? f(min) : `${f(min)}–${f(max)}`);
    if (t.metric === "power") absolute = `${range(t.min, t.max, String)} W`;
    if (t.metric === "heart_rate") absolute = `${range(t.min, t.max, String)} bpm`;
    if (t.metric === "pace") absolute = `${range(t.min, t.max, formatClock)} ${t.unit === "sec_per_km" ? "/km" : "/100 m"}`;
  }
  if (!absolute || absolute === prescribed) return <span className="figure text-ink">{prescribed}</span>;
  return (
    <span>
      <span className="figure text-ink">{absolute}</span> <span className="text-muted">({prescribed})</span>
    </span>
  );
}

function StepLine({ step, sport, thresholds }: { step: Step; sport: SegmentSport; thresholds?: AthleteThresholds }) {
  const percent = intensityPercent(step, sport, thresholds);
  return (
    <li className="flex gap-3 py-2">
      <span aria-hidden className={cn("mt-1 w-1 shrink-0 self-stretch rounded-full", zoneClass(percent))} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
          <span className="figure text-[15px] text-ink">{describeLength(step.length, sport)}</span>
          <span className="font-medium text-ink-soft">{step.label ?? STEP_TYPE_LABELS[step.type]}</span>
          {step.sendOffSeconds ? <span className="text-[13px] text-muted">départ toutes les {formatClock(step.sendOffSeconds)}</span> : null}
        </p>
        {step.targets.length ? (
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
            {step.targets.map((target, index) => (
              <TargetText key={index} target={target} sport={sport} thresholds={thresholds} />
            ))}
          </p>
        ) : null}
        {step.notes ? <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{step.notes}</p> : null}
        {step.equipment?.length ? (
          <p className="mt-1 text-[12px] text-muted">Matériel : {step.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ")}</p>
        ) : null}
      </div>
    </li>
  );
}

function Nodes({ nodes, sport, thresholds }: { nodes: WorkoutNode[]; sport: SegmentSport; thresholds?: AthleteThresholds }) {
  return (
    <ul className="divide-y divide-line">
      {nodes.map((node) =>
        node.kind === "repeat" ? (
          <li key={node.id} className="py-2">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Repeat2 className="size-4 text-muted" aria-hidden />
              <span className="figure text-[15px]">{node.count} ×</span>
              {node.label ? <span className="text-ink-soft">{node.label}</span> : null}
            </p>
            <div className="ml-2 mt-1 border-l-2 border-ink/12 pl-3">
              <Nodes nodes={node.steps} sport={sport} thresholds={thresholds} />
            </div>
          </li>
        ) : (
          <StepLine key={node.id} step={node} sport={sport} thresholds={thresholds} />
        ),
      )}
    </ul>
  );
}

/** Prescription détaillée, étape par étape, avec les cibles calculées pour l’athlète. */
export function Prescription({ workout, thresholds }: { workout: Workout; thresholds?: AthleteThresholds }) {
  const multi = workout.segments.length > 1;
  return (
    <div className="space-y-4">
      {workout.segments.map((segment) => (
        <section key={segment.id} aria-label={SPORT_LABELS[segment.sport]}>
          {multi ? (
            <h4 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <SportDot sport={segment.sport} />
              {segment.title || SPORT_LABELS[segment.sport]}
            </h4>
          ) : null}
          {segment.goal ? <p className="mb-1 text-[13px] text-ink-soft">{segment.goal}</p> : null}
          <Nodes nodes={segment.steps} sport={segment.sport} thresholds={thresholds} />
        </section>
      ))}
    </div>
  );
}
