"use client";

import { Check, ClipboardCopy, Repeat } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SUUNTO_TARGET_LABELS, type SuuntoPlan, type SuuntoSegmentPlan, type SuuntoStep } from "@/lib/export/suunto-steps";
import { SPORT_LABELS } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

/** Texte à coller dans l'application Suunto (nom, description), avec son bouton de copie. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("ok");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <dt className="text-[12px] text-muted">{label}</dt>
        <dd className="text-[13.5px] break-words text-ink select-all">{value}</dd>
        {state === "error" ? <p className="text-[12px] text-danger">Copie refusée par le navigateur : sélectionnez le texte.</p> : null}
      </div>
      <Button size="sm" variant="ghost" onClick={copy} aria-label={`Copier : ${label.toLowerCase()}`}>
        {state === "ok" ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
        {state === "ok" ? "Copié" : "Copier"}
      </Button>
    </div>
  );
}

const endText = (step: SuuntoStep) => (step.end.kind === "lap" ? "bouton tour" : `${step.end.kind === "duration" ? "durée" : "distance"} ${step.end.text}`);

/** Une étape, cochable pour ne pas se perdre en passant d'une application à l'autre. */
function StepRow({ step, number, done, onToggle }: { step: SuuntoStep; number: number; done: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer gap-2.5 py-1.5">
        <input type="checkbox" checked={done} onChange={onToggle} className="mt-[3px] size-4 shrink-0 accent-[var(--success)]" />
        <span className={cn("min-w-0 text-[13.5px] leading-snug", done && "text-muted line-through")}>
          <span className="figure mr-1 text-muted">{number}.</span>
          <span className="font-semibold text-ink">{step.phase}</span>
          {step.name ? <span className="text-ink-soft"> « {step.name} »</span> : null}
          <span className="block text-ink-soft">
            Fin : <span className="whitespace-nowrap">{endText(step)}</span>. Objectif :{" "}
            <span className="whitespace-nowrap">{step.target ? `${SUUNTO_TARGET_LABELS[step.target.kind].toLowerCase()} ${step.target.value}` : "aucun"}</span>.
          </span>
          {step.notes.map((note) => (
            <span key={note} className="block text-[12.5px] text-muted">
              {note}
            </span>
          ))}
        </span>
      </label>
    </li>
  );
}

function SegmentSteps({ segment, prefix }: { segment: SuuntoSegmentPlan; prefix: string }) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setDone((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Numéros continus d'une répétition à l'autre : l'ordre de saisie dans Suunto.
  const firstNumber = segment.items.reduce<number[]>((acc, item, index) => {
    const previous = index === 0 ? 1 : acc[index - 1] + (segment.items[index - 1].kind === "step" ? 1 : (segment.items[index - 1] as { steps: unknown[] }).steps.length);
    return [...acc, previous];
  }, []);

  return (
    <>
      {segment.warnings.length ? (
        <ul className="mt-2 space-y-1">
          {segment.warnings.map((warning) => (
            <li key={warning} className="rounded-[8px] bg-warning-soft px-2.5 py-1.5 text-[12.5px] leading-snug text-ink">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="mt-2 space-y-1" aria-label={`Étapes ${prefix}`}>
        {segment.items.map((item, index) => {
          if (item.kind === "step") {
            const key = `${index}`;
            return <StepRow key={key} step={item} number={firstNumber[index]} done={done.has(key)} onToggle={() => toggle(key)} />;
          }
          return (
            <li key={index} className="rounded-[10px] border border-line px-2.5 py-1.5">
              <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                <Repeat aria-hidden className="size-3.5 text-muted" />
                Répétition, {item.count} fois{item.name ? <span className="font-normal text-ink-soft"> « {item.name} »</span> : null}
              </p>
              <ol>
                {item.steps.map((step, inner) => {
                  const key = `${index}.${inner}`;
                  return <StepRow key={key} step={step} number={firstNumber[index] + inner} done={done.has(key)} onToggle={() => toggle(key)} />;
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** La séance écrite comme le créateur d'entraînements structurés de l'application Suunto. */
export function SuuntoSteps({ plan, dateLabel }: { plan: SuuntoPlan; dateLabel: string }) {
  const multi = plan.segments.length > 1;
  return (
    <div className="mt-2 space-y-4" data-suunto-steps>
      {plan.segments.map((segment, index) => {
        const sport = SPORT_LABELS[segment.sport];
        const name = multi ? `${plan.name} (${index + 1}/${plan.segments.length} ${sport.toLowerCase()})` : plan.name;
        return (
          <section key={index} aria-label={multi ? `Partie ${index + 1} : ${sport}` : "Entraînement Suunto"} className="space-y-2">
            {multi ? (
              <h4 className="text-[14px] font-semibold text-ink">
                Partie {index + 1} : {sport.toLowerCase()}
              </h4>
            ) : null}
            <dl className="space-y-1.5 rounded-[10px] bg-surface-2 p-2.5">
              <CopyField label="Nom" value={name} />
              {plan.description ? <CopyField label="Description (affichée sur la montre)" value={plan.description} /> : null}
              <div>
                <dt className="text-[12px] text-muted">Mode sportif</dt>
                <dd className="text-[13.5px] text-ink">{segment.sportMode}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Date</dt>
                <dd className="text-[13.5px] text-ink">{dateLabel}</dd>
              </div>
            </dl>
            <p className="text-[12.5px] text-muted">
              {segment.stepCount} étape{segment.stepCount > 1 ? "s" : ""} à saisir dans l’ordre ; cochez-les au fur et à mesure.
            </p>
            <SegmentSteps segment={segment} prefix={multi ? `de la partie ${index + 1}` : "de l’entraînement"} />
          </section>
        );
      })}
    </div>
  );
}
