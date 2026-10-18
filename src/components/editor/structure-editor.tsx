"use client";

import { ChevronDown, ChevronRight, ChevronUp, Copy, Minus, Plus, Repeat2, Trash2, Ungroup, X } from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";
import { SportDot } from "@/components/sport";
import { zoneClass } from "@/components/workout/workout-profile";
import { intensityPercent } from "@/lib/workout/compute";
import {
  appendNode,
  canWrapInRepeat,
  collectIds,
  duplicateNode,
  makeRepeat,
  makeStep,
  moveNode,
  removeNode,
  repeatDepth,
  setSegmentSport,
  unwrapRepeat,
  updateNode,
  updateStep,
  wrapInRepeat,
  type NodePath,
} from "@/lib/workout/edit";
import { formatDistanceInput, formatDurationInput, parseDistance, parseDuration } from "@/lib/workout/inputs";
import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  LIMITS,
  SEGMENT_SPORTS,
  SPORT_LABELS,
  SPORT_TARGETS,
  STEP_TYPES,
  STEP_TYPE_LABELS,
  type Length,
  type Repeat,
  type SegmentSport,
  type Step,
  type Target,
  type Workout,
  type WorkoutNode,
} from "@/lib/workout/schema";
import type { WorkoutIssue } from "@/lib/workout/warnings";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";
import {
  allowedTargetKeys,
  defaultTargetFor,
  formatTargetValue,
  parseTargetValue,
  resolvedHint,
  targetKey,
  targetLabel,
  targetSuffix,
} from "./target-meta";
import { Select } from "@/components/ui/field";
import { ValueInput } from "./value-input";

interface StructureContext {
  workout: Workout;
  update: (change: (workout: Workout) => Workout) => void;
  notify: (message: string) => void;
  thresholds?: AthleteThresholds;
  issues: Map<string, WorkoutIssue[]>;
  errors: Map<string, string>;
  readOnly: boolean;
}

const Ctx = createContext<StructureContext | null>(null);
const useStructure = () => {
  const value = use(Ctx);
  if (!value) throw new Error("StructureEditor manquant");
  return value;
};

function IconButton({ label, onClick, disabled, children, tone = "default" }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-[15px]",
        tone === "danger" && "hover:bg-danger-soft hover:text-danger",
      )}
    >
      {children}
    </button>
  );
}

export function StructureEditor({
  workout,
  onChange,
  onNotify,
  thresholds,
  issues,
  errors,
  readOnly = false,
}: {
  workout: Workout;
  onChange: (change: (workout: Workout) => Workout) => void;
  onNotify: (message: string) => void;
  thresholds?: AthleteThresholds;
  issues: Map<string, WorkoutIssue[]>;
  errors: Map<string, string>;
  readOnly?: boolean;
}) {
  const multi = workout.segments.length > 1;
  return (
    <Ctx value={{ workout, update: onChange, notify: onNotify, thresholds, issues, errors, readOnly }}>
      <div className="space-y-5">
        {workout.segments.map((segment, index) => (
          <section key={segment.id} aria-label={multi ? `Segment ${index + 1} : ${SPORT_LABELS[segment.sport]}` : "Structure de la séance"}>
            {multi ? <SegmentHeader index={index} /> : null}
            <NodeList nodes={segment.steps} parent={[index]} sport={segment.sport} />
          </section>
        ))}
      </div>
    </Ctx>
  );
}

function SegmentHeader({ index }: { index: number }) {
  const { workout, update, notify, readOnly } = useStructure();
  const segment = workout.segments[index];
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2">
      <SportDot sport={segment.sport} className="size-3" />
      <span className="heading text-[15px]">
        {index + 1}. {segment.title || SPORT_LABELS[segment.sport]}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <label className="sr-only" htmlFor={`seg-sport-${segment.id}`}>
          Discipline du segment
        </label>
        <Select
          size="sm"
          wrapperClassName="w-36"
          id={`seg-sport-${segment.id}`}
          value={segment.sport}
          disabled={readOnly}
          onChange={(event) => {
            const sport = event.target.value as SegmentSport;
            const result = setSegmentSport(workout, index, sport, (s, key) => SPORT_TARGETS[s].includes(key));
            update(() => result.workout);
            if (result.removedTargets > 0) {
              notify(
                `${result.removedTargets} cible${result.removedTargets > 1 ? "s" : ""} retirée${result.removedTargets > 1 ? "s" : ""} : elle${result.removedTargets > 1 ? "s n’existent" : " n’existe"} pas en ${SPORT_LABELS[sport].toLowerCase()}.`,
              );
            }
          }}
        >
          {SEGMENT_SPORTS.map((sport) => (
            <option key={sport} value={sport}>
              {SPORT_LABELS[sport]}
            </option>
          ))}
        </Select>
        <IconButton
          label="Monter le segment"
          disabled={readOnly || index === 0}
          onClick={() =>
            update((w) => {
              const segments = [...w.segments];
              [segments[index - 1], segments[index]] = [segments[index], segments[index - 1]];
              return { ...w, segments };
            })
          }
        >
          <ChevronUp />
        </IconButton>
        <IconButton
          label="Supprimer le segment"
          tone="danger"
          disabled={readOnly || workout.segments.length <= 1}
          onClick={() => update((w) => ({ ...w, segments: w.segments.filter((_, i) => i !== index) }))}
        >
          <Trash2 />
        </IconButton>
      </span>
    </div>
  );
}

function NodeList({ nodes, parent, sport }: { nodes: WorkoutNode[]; parent: NodePath; sport: SegmentSport }) {
  const { update, readOnly } = useStructure();
  const depth = Math.max(parent.length - 1, 0);
  return (
    <div className="space-y-2">
      {nodes.map((node, index) => {
        const path = [...parent, index];
        return node.kind === "repeat" ? (
          <RepeatBlock key={node.id} repeat={node} path={path} sport={sport} siblings={nodes.length} />
        ) : (
          <StepCard key={node.id} step={node} path={path} sport={sport} siblings={nodes.length} />
        );
      })}
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={nodes.length >= LIMITS.maxNodesPerList}
            onClick={() => update((w) => appendNode(w, parent, makeStep(sport, "active", collectIds(w))))}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-dashed border-line-strong px-3 text-[13px] font-medium text-ink-soft hover:border-ink hover:text-ink"
          >
            <Plus className="size-4" aria-hidden />
            Étape
          </button>
          <button
            type="button"
            disabled={depth >= LIMITS.maxRepeatDepth || nodes.length >= LIMITS.maxNodesPerList}
            onClick={() => update((w) => appendNode(w, parent, makeRepeat(sport, collectIds(w), 3)))}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-dashed border-line-strong px-3 text-[13px] font-medium text-ink-soft hover:border-ink hover:text-ink disabled:opacity-40"
          >
            <Repeat2 className="size-4" aria-hidden />
            Répétition
          </button>
        </div>
      )}
    </div>
  );
}

function NodeActions({ path, siblings, node }: { path: NodePath; siblings: number; node: WorkoutNode }) {
  const { workout, update, readOnly } = useStructure();
  if (readOnly) return null;
  const index = path[path.length - 1];
  const onlyNodeOfSegment = path.length === 2 && siblings === 1;
  return (
    <span className="flex items-center">
      <IconButton label="Monter" disabled={index === 0} onClick={() => update((w) => moveNode(w, path, -1))}>
        <ChevronUp />
      </IconButton>
      <IconButton label="Descendre" disabled={index === siblings - 1} onClick={() => update((w) => moveNode(w, path, 1))}>
        <ChevronDown />
      </IconButton>
      <IconButton label="Dupliquer" onClick={() => update((w) => duplicateNode(w, path))}>
        <Copy />
      </IconButton>
      {node.kind === "repeat" ? (
        <IconButton label="Dérouler la répétition" onClick={() => update((w) => unwrapRepeat(w, path))}>
          <Ungroup />
        </IconButton>
      ) : (
        <IconButton label="Répéter ce bloc" disabled={!canWrapInRepeat(workout, path)} onClick={() => update((w) => wrapInRepeat(w, path))}>
          <Repeat2 />
        </IconButton>
      )}
      <IconButton label="Supprimer" tone="danger" disabled={onlyNodeOfSegment} onClick={() => update((w) => removeNode(w, path))}>
        <Trash2 />
      </IconButton>
    </span>
  );
}

function RepeatBlock({ repeat, path, sport, siblings }: { repeat: Repeat; path: NodePath; sport: SegmentSport; siblings: number }) {
  const { update, readOnly, issues } = useStructure();
  const setCount = (count: number) =>
    update((w) => updateNode(w, path, (node) => (node.kind === "repeat" ? { ...node, count: Math.min(Math.max(1, count), LIMITS.maxRepeatCount) } : node)));
  const nodeIssues = issues.get(repeat.id) ?? [];
  return (
    <div className="rounded-[10px] border border-line-strong bg-surface-2/60">
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        <Repeat2 className="size-4 text-muted" aria-hidden />
        <span className="text-[13px] font-semibold text-ink-soft">Répéter</span>
        <span className="flex items-center rounded-[6px] border border-line-strong bg-surface">
          <button
            type="button"
            aria-label="Une fois de moins"
            disabled={readOnly || repeat.count <= 1}
            onClick={() => setCount(repeat.count - 1)}
            className="flex size-8 items-center justify-center text-muted hover:text-ink disabled:opacity-30"
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <ValueInput
            aria-label="Nombre de répétitions"
            value={repeat.count}
            format={String}
            parse={(raw) => {
              const n = Number(raw);
              return Number.isInteger(n) && n >= 1 && n <= LIMITS.maxRepeatCount ? n : null;
            }}
            onCommit={setCount}
            disabled={readOnly}
            inputMode="numeric"
            className="h-8 w-10 border-0 text-center focus:ring-0"
          />
          <button
            type="button"
            aria-label="Une fois de plus"
            disabled={readOnly || repeat.count >= LIMITS.maxRepeatCount}
            onClick={() => setCount(repeat.count + 1)}
            className="flex size-8 items-center justify-center text-muted hover:text-ink disabled:opacity-30"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </span>
        <span className="text-[13px] font-semibold text-ink-soft">fois</span>
        <input
          aria-label="Intitulé de la répétition"
          placeholder="Intitulé (facultatif)"
          value={repeat.label ?? ""}
          disabled={readOnly}
          maxLength={80}
          onChange={(event) =>
            update((w) => updateNode(w, path, (node) => (node.kind === "repeat" ? { ...node, label: event.target.value || undefined } : node)))
          }
          className="h-8 min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-2 text-[13px] text-ink outline-none placeholder:text-muted/70 hover:border-line focus:border-ink focus:bg-surface"
        />
        <span className="ml-auto">
          <NodeActions path={path} siblings={siblings} node={repeat} />
        </span>
      </div>
      {nodeIssues.length ? <IssueLines issues={nodeIssues} className="px-3 pb-2" /> : null}
      <div className="border-l-2 border-ink/15 pb-2.5 pl-3 pr-2.5 ml-3.5">
        <NodeList nodes={repeat.steps} parent={path} sport={sport} />
      </div>
    </div>
  );
}

const LENGTH_MODES: { unit: Length["unit"]; label: string }[] = [
  { unit: "time", label: "Durée" },
  { unit: "distance", label: "Distance" },
  { unit: "reps", label: "Répétitions" },
  { unit: "open", label: "Libre" },
];

function lengthFor(unit: Length["unit"], previous: Length, sport: SegmentSport): Length {
  if (unit === previous.unit) return previous;
  if (unit === "time") return { unit, seconds: 600 };
  if (unit === "distance") return { unit, meters: sport === "swim" ? 100 : 1000 };
  if (unit === "reps") return { unit, reps: 10 };
  return { unit: "open" };
}

function StepCard({ step, path, sport, siblings }: { step: Step; path: NodePath; sport: SegmentSport; siblings: number }) {
  const { update, thresholds, readOnly, issues, errors } = useStructure();
  const [detailsOpen, setDetailsOpen] = useState(Boolean(step.label || step.notes || step.equipment?.length));
  const patch = (changes: Partial<Omit<Step, "kind" | "id">>) => update((w) => updateStep(w, path, changes));
  const percent = intensityPercent(step, sport, thresholds);
  const nodeIssues = issues.get(step.id) ?? [];
  const error = errors.get(step.id);
  const allowedKeys = allowedTargetKeys(sport);
  const usedMetrics = new Set(step.targets.map((t) => t.metric));

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[10px] border bg-surface",
        error ? "border-danger/60" : "border-line",
        repeatDepth(path) > 0 && "bg-surface",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[4px]", zoneClass(percent))} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 py-2 pl-3.5 pr-2">
        <label className="sr-only" htmlFor={`type-${step.id}`}>
          Type d’étape
        </label>
        <Select
          size="sm"
          wrapperClassName="w-[9.5rem]"
          id={`type-${step.id}`}
          value={step.type}
          disabled={readOnly}
          onChange={(event) => patch({ type: event.target.value as Step["type"] })}
        >
          {STEP_TYPES.map((type) => (
            <option key={type} value={type}>
              {STEP_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>

        <span className="flex items-center gap-1">
          <label className="sr-only" htmlFor={`len-${step.id}`}>
            Mesure de l’étape
          </label>
          <Select
            size="sm"
            wrapperClassName="w-[7.5rem]"
            id={`len-${step.id}`}
            value={step.length.unit}
            disabled={readOnly}
            onChange={(event) => {
              const length = lengthFor(event.target.value as Length["unit"], step.length, sport);
              patch(length.unit === "distance" ? { length } : { length, sendOffSeconds: undefined });
            }}
          >
            {LENGTH_MODES.filter((m) => m.unit !== "reps" || sport === "strength" || step.length.unit === "reps").map((mode) => (
              <option key={mode.unit} value={mode.unit}>
                {mode.label}
              </option>
            ))}
          </Select>
          <LengthInput step={step} sport={sport} onChange={(length) => patch({ length })} disabled={readOnly} />
        </span>

        <span className="ml-auto flex items-center">
          <NodeActions path={path} siblings={siblings} node={step} />
        </span>
      </div>

      <div className="space-y-1.5 pb-2 pl-3.5 pr-2">
        {step.targets.map((target, index) => (
          <TargetRow
            key={`${target.metric}-${index}`}
            target={target}
            sport={sport}
            stepId={step.id}
            usedMetrics={usedMetrics}
            allowedKeys={allowedKeys}
            thresholds={thresholds}
            disabled={readOnly}
            onChange={(next) => patch({ targets: step.targets.map((t, i) => (i === index ? next : t)) })}
            onRemove={() => patch({ targets: step.targets.filter((_, i) => i !== index) })}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && step.targets.length < LIMITS.maxTargetsPerStep && step.type !== "rest" && step.type !== "transition" ? (
            <button
              type="button"
              onClick={() => {
                const key = allowedKeys.find((k) => !usedMetrics.has(k.split(".")[0] as Target["metric"]));
                if (key) patch({ targets: [...step.targets, defaultTargetFor(key, sport, thresholds)] });
              }}
              className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              <Plus className="size-3.5" aria-hidden />
              Cible
            </button>
          ) : null}
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
            className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", detailsOpen && "rotate-90")} aria-hidden />
            {step.label || step.notes || step.equipment?.length || step.sendOffSeconds ? "Détails renseignés" : "Détails"}
          </button>
        </div>
        {detailsOpen ? <StepDetails step={step} sport={sport} onPatch={patch} disabled={readOnly} /> : null}
        {error ? <p className="text-[12px] font-medium text-danger">{error}</p> : null}
        {nodeIssues.length ? <IssueLines issues={nodeIssues} /> : null}
      </div>
    </div>
  );
}

function LengthInput({ step, sport, onChange, disabled }: { step: Step; sport: SegmentSport; onChange: (length: Length) => void; disabled: boolean }) {
  const { length } = step;
  if (length.unit === "time") {
    return (
      <ValueInput
        aria-label="Durée (min, m:ss ou h:mm:ss)"
        value={length.seconds}
        format={formatDurationInput}
        parse={(raw) => {
          const s = parseDuration(raw);
          return s !== null && s <= LIMITS.maxStepSeconds ? s : null;
        }}
        onCommit={(seconds) => onChange({ unit: "time", seconds })}
        disabled={disabled}
        className="w-[5.5rem]"
        invalidMessage="Durée illisible : 45, 4:30 ou 1:30:00"
      />
    );
  }
  if (length.unit === "distance") {
    return (
      <ValueInput
        aria-label={sport === "swim" ? "Distance en mètres" : "Distance (m ou km)"}
        value={length.meters}
        format={formatDistanceInput}
        parse={(raw) => {
          const m = parseDistance(raw);
          return m !== null && m <= LIMITS.maxStepMeters ? m : null;
        }}
        onCommit={(meters) => onChange({ unit: "distance", meters })}
        disabled={disabled}
        className="w-[5.5rem]"
        invalidMessage="Distance illisible : 400 ou 1,5 km"
      />
    );
  }
  if (length.unit === "reps") {
    return (
      <ValueInput
        aria-label="Nombre de répétitions"
        value={length.reps}
        format={String}
        parse={(raw) => {
          const n = Number(raw);
          return Number.isInteger(n) && n >= 1 && n <= LIMITS.maxReps ? n : null;
        }}
        onCommit={(reps) => onChange({ unit: "reps", reps })}
        disabled={disabled}
        inputMode="numeric"
        className="w-[4.5rem]"
      />
    );
  }
  return <span className="px-1 text-[13px] text-muted">jusqu’à l’appui sur Tour</span>;
}

function TargetRow({
  target,
  sport,
  stepId,
  usedMetrics,
  allowedKeys,
  thresholds,
  disabled,
  onChange,
  onRemove,
}: {
  target: Target;
  sport: SegmentSport;
  stepId: string;
  usedMetrics: Set<Target["metric"]>;
  allowedKeys: string[];
  thresholds?: AthleteThresholds;
  disabled: boolean;
  onChange: (target: Target) => void;
  onRemove: () => void;
}) {
  const key = targetKey(target);
  const hint = resolvedHint(target, sport, thresholds);
  const options = allowedKeys.filter((k) => k === key || !usedMetrics.has(k.split(".")[0] as Target["metric"]));
  const parse = (raw: string) => parseTargetValue(key, raw);
  const format = (value: number) => formatTargetValue(key, value);
  const id = `${stepId}-${target.metric}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={`metric-${id}`}>
        Type de cible
      </label>
      <Select
        size="sm"
        wrapperClassName="w-[10.5rem]"
        id={`metric-${id}`}
        value={key}
        disabled={disabled}
        onChange={(event) => onChange(defaultTargetFor(event.target.value, sport, thresholds))}
      >
        {options.map((k) => (
          <option key={k} value={k}>
            {targetLabel(k, sport)}
          </option>
        ))}
      </Select>
      <ValueInput
        aria-label="Borne basse"
        value={target.min}
        format={format}
        parse={parse}
        onCommit={(min) => onChange({ ...target, min, max: Math.max(min, target.max) })}
        disabled={disabled}
        className="w-[4.25rem] text-center"
      />
      <span className="text-muted" aria-hidden>
        –
      </span>
      <ValueInput
        aria-label="Borne haute"
        value={target.max}
        format={format}
        parse={parse}
        onCommit={(max) => onChange({ ...target, max, min: Math.min(target.min, max) })}
        disabled={disabled}
        className="w-[4.25rem] text-center"
      />
      {targetSuffix(key) ? <span className="text-[12px] font-medium text-muted">{targetSuffix(key)}</span> : null}
      {hint ? (
        <span className={cn("figure ml-1 text-[13px]", hint.missing ? "text-warning" : "text-ink-soft")}>
          {hint.missing ? hint.text : `≈ ${hint.text}`}
        </span>
      ) : null}
      {disabled ? null : (
        <button
          type="button"
          aria-label="Retirer la cible"
          onClick={onRemove}
          className="ml-auto flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function StepDetails({
  step,
  sport,
  onPatch,
  disabled,
}: {
  step: Step;
  sport: SegmentSport;
  onPatch: (changes: Partial<Omit<Step, "kind" | "id">>) => void;
  disabled: boolean;
}) {
  const equipment = new Set(step.equipment ?? []);
  return (
    <div className="grid gap-3 rounded-[8px] bg-surface-2/70 p-3 sm:grid-cols-2">
      <label className="space-y-1">
        <span className="block text-[12px] font-semibold text-ink-soft">Intitulé</span>
        <input
          value={step.label ?? ""}
          maxLength={80}
          disabled={disabled}
          placeholder="Ex. : Squats, Rattrapé"
          onChange={(event) => onPatch({ label: event.target.value || undefined })}
          className="h-8 w-full rounded-[6px] border border-line-strong bg-surface px-2 text-[13px] outline-none focus:border-ink"
        />
      </label>
      {sport === "swim" && step.length.unit === "distance" ? (
        <label className="space-y-1">
          <span className="block text-[12px] font-semibold text-ink-soft">Départ toutes les (m:ss)</span>
          <ValueInput
            value={step.sendOffSeconds ?? 0}
            format={(s) => (s ? formatDurationInput(s) : "")}
            parse={(raw) => {
              if (!raw.trim()) return 0;
              const s = parseDuration(raw.includes(":") ? raw : `${raw} s`);
              return s !== null && s >= 10 && s <= 3600 ? s : null;
            }}
            onCommit={(s) => onPatch({ sendOffSeconds: s || undefined })}
            disabled={disabled}
            className="w-full"
            placeholder="1:50"
          />
        </label>
      ) : null}
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-[12px] font-semibold text-ink-soft">Consignes de l’étape</span>
        <textarea
          value={step.notes ?? ""}
          maxLength={LIMITS.maxText}
          disabled={disabled}
          rows={2}
          onChange={(event) => onPatch({ notes: event.target.value || undefined })}
          className="w-full rounded-[6px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-ink"
        />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[12px] font-semibold text-ink-soft">Matériel</legend>
        <div className="flex flex-wrap gap-1.5">
          {EQUIPMENT.map((item) => {
            const active = equipment.has(item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => {
                  const next = new Set(equipment);
                  if (active) next.delete(item);
                  else next.add(item);
                  onPatch({ equipment: next.size ? EQUIPMENT.filter((e) => next.has(e)) : undefined });
                }}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
                  active ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink-soft hover:border-ink",
                )}
              >
                {EQUIPMENT_LABELS[item]}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

export function IssueLines({ issues, className }: { issues: WorkoutIssue[]; className?: string }) {
  return (
    <ul className={cn("space-y-0.5", className)}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={cn("text-[12px] leading-snug", issue.severity === "warning" ? "text-warning" : "text-muted")}>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
