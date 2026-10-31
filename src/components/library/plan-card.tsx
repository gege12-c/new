"use client";

import { CalendarPlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { applyTrainingPlan, deleteTrainingPlan } from "@/app/(app)/plan-actions";
import { SPORT_STYLES } from "@/components/sport";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import type { TrainingPlanSummary } from "@/lib/data/plans";
import { addDays, startOfWeek } from "@/lib/planning/dates";
import { formatDurationShort } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

const DAYS = ["L", "M", "M", "J", "V", "S", "D"];

/** Un plan : ses semaines en miniature, l’application à un athlète et la suppression. */
export function PlanCard({ plan, athletes, today }: { plan: TrainingPlanSummary; athletes: { id: string; name: string }[]; today: string }) {
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [athleteId, setAthleteId] = useState(athletes[0]?.id ?? "");
  const [start, setStart] = useState(addDays(startOfWeek(today), 7));
  const [publish, setPublish] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string; href?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const total = plan.sessions.reduce((sum, s) => sum + (s.planned_duration_s ?? 0), 0);

  return (
    <li className="flex flex-col rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="heading truncate text-[16px]">{plan.name}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {plan.weeks} semaine{plan.weeks > 1 ? "s" : ""}, {plan.sessions.length} séance{plan.sessions.length > 1 ? "s" : ""}
            {total ? `, ${formatDurationShort(total)} prévues` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDeleting(true)} aria-label={`Supprimer le plan ${plan.name}`}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      {plan.description ? <p className="mt-2 line-clamp-2 text-[13.5px] text-ink-soft">{plan.description}</p> : null}
      <div className="mt-3 space-y-1" aria-label="Séances par semaine">
        {Array.from({ length: Math.min(plan.weeks, 8) }, (_, week) => (
          <div key={week} className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] items-center gap-1">
            <span className="figure text-[11px] text-muted">S{week + 1}</span>
            {DAYS.map((label, day) => {
              const sessions = plan.sessions.filter((s) => s.day_offset === week * 7 + day);
              return (
                <span key={day} className="flex h-4 gap-[2px] rounded-[3px] bg-surface-2" title={sessions.map((s) => s.title).join(", ") || `${label} : repos`}>
                  {sessions.map((s, i) => (
                    <span key={i} className={cn("h-full flex-1 rounded-[3px]", SPORT_STYLES[s.sport].solid)} />
                  ))}
                </span>
              );
            })}
          </div>
        ))}
        {plan.weeks > 8 ? <p className="text-[11.5px] text-muted">… et {plan.weeks - 8} semaines de plus.</p> : null}
      </div>
      <div className="mt-auto pt-3">
        <Button size="sm" variant="secondary" onClick={() => setApplying(true)} disabled={!athletes.length}>
          <CalendarPlus aria-hidden />
          Appliquer à un athlète
        </Button>
      </div>

      <Dialog open={applying} onClose={() => setApplying(false)} title={`Appliquer « ${plan.name} »`}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await applyTrainingPlan({ planId: plan.id, athleteId, start, publish });
              if (result.status === "ok") {
                const name = athletes.find((a) => a.id === athleteId)?.name ?? "l’athlète";
                setMessage({
                  tone: "success",
                  text: `${result.count} séance${result.count > 1 ? "s" : ""} ${publish ? "publiée" : "ajoutée"}${result.count > 1 ? "s" : ""} ${publish ? "" : "en brouillon "}pour ${name}.`,
                  href: `/coach/athletes/${athleteId}?view=month&date=${start}`,
                });
              } else setMessage({ tone: "error", text: result.message });
            });
          }}
        >
          <Field label="Athlète" htmlFor={`plan-athlete-${plan.id}`}>
            <Select id={`plan-athlete-${plan.id}`} value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Premier lundi" htmlFor={`plan-start-${plan.id}`} hint="La semaine 1 du plan commence ce lundi.">
            <Input id={`plan-start-${plan.id}`} type="date" step={7} required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <label className="flex items-start gap-3 text-[14px]">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="mt-1 size-[18px] accent-[var(--ink)]" />
            <span>
              <span className="font-medium">Publier tout de suite</span>
              <span className="block text-[13px] text-muted">Sinon, les séances arrivent en brouillon, à vérifier et publier depuis le calendrier.</span>
            </span>
          </label>
          {message ? (
            <Notice tone={message.tone}>
              {message.text}{" "}
              {message.href ? (
                <Link href={message.href} className="font-semibold underline underline-offset-4">
                  Voir le calendrier
                </Link>
              ) : null}
            </Notice>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setApplying(false)}>
              Fermer
            </Button>
            <Button type="submit" disabled={pending || !athleteId}>
              Appliquer
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        title={`Supprimer le plan « ${plan.name} » ?`}
        confirmLabel="Supprimer"
        pending={pending}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteTrainingPlan(plan.id);
            setDeleting(false);
            if (result.status === "error") setMessage({ tone: "error", text: result.message });
          })
        }
      >
        Les séances déjà planifiées à partir de ce plan restent dans les calendriers.
      </ConfirmDialog>
    </li>
  );
}
