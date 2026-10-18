"use client";

import { Check, Link2, Trash2, Unlink, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { associateActivity, clearCompletion, declareCompletion, deleteImportedActivity, dissociateActivity } from "@/app/(app)/activity-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { controlClasses } from "@/components/ui/field";
import type { SessionCompletion } from "@/lib/data/planning-types";
import { cn } from "@/lib/utils";

type Outcome = { status: "ok"; message?: string } | { status: "error"; message: string };

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<Outcome>) =>
    start(async () => {
      setError(null);
      const result = await action();
      if (result.status === "error") setError(result.message);
    });
  return { pending, error, run };
}

/** Rattache une activité à une séance (décision de l’utilisateur : jamais remise en cause par le rapprochement automatique). */
export function AttachButton({ sessionId, activityId, label = "Rattacher", variant = "secondary" }: { sessionId: string; activityId: string; label?: string; variant?: "primary" | "secondary" }) {
  const { pending, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant={variant} disabled={pending} onClick={() => run(() => associateActivity(sessionId, activityId))}>
        <Link2 aria-hidden />
        {pending ? "Rattachement…" : label}
      </Button>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </span>
  );
}

/** Détache une activité (ou écarte une proposition) : cette paire ne sera plus proposée. */
export function DetachButton({ sessionId, activityId, label = "Détacher" }: { sessionId: string; activityId: string; label?: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dissociateActivity(sessionId, activityId))}>
        <Unlink aria-hidden />
        {pending ? "…" : label}
      </Button>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </span>
  );
}

/** Proposition du rapprochement automatique, à confirmer ou écarter. */
export function ProposalButtons({ sessionId, activityId }: { sessionId: string; activityId: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => associateActivity(sessionId, activityId))}>
          <Check aria-hidden />
          C’est bien cette séance
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dissociateActivity(sessionId, activityId))}>
          <X aria-hidden />
          Ce n’est pas elle
        </Button>
      </div>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}

export function DeleteImportedButton({ activityId, onDeletedHref, compact = false }: { activityId: string; onDeletedHref?: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <>
      {compact ? (
        <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="Supprimer cette activité importée" title="Supprimer l’import" className="size-8 text-muted hover:text-danger">
          <Trash2 aria-hidden />
        </Button>
      ) : (
        <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden />
          Supprimer l’import
        </Button>
      )}
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
      <ConfirmDialog
        open={open}
        title="Supprimer cette activité importée ?"
        confirmLabel="Supprimer"
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          run(async () => {
            const result = await deleteImportedActivity(activityId);
            if (result.status === "ok") {
              setOpen(false);
              if (onDeletedHref) router.replace(onDeletedHref, { scroll: false });
            }
            return result;
          })
        }
      >
        Elle disparaît de TriCoach, pour vous et votre coach. Le fichier d’origine reste sur votre appareil : vous pourrez l’importer à nouveau.
      </ConfirmDialog>
    </>
  );
}

const COMPLETION_CHOICES: { value: SessionCompletion["status"]; label: string; tone: string }[] = [
  { value: "done", label: "Faite", tone: "peer-checked:bg-success peer-checked:text-canvas peer-checked:border-success" },
  { value: "partial", label: "En partie", tone: "peer-checked:bg-warning peer-checked:text-canvas peer-checked:border-warning" },
  { value: "skipped", label: "Pas faite", tone: "peer-checked:bg-danger peer-checked:text-canvas peer-checked:border-danger" },
];

/** Retour de l’athlète sur la séance, transmis à son coach : faite ou non, effort ressenti, note. */
export function CompletionForm({ sessionId, completion }: { sessionId: string; completion: SessionCompletion | null }) {
  const [status, setStatus] = useState<SessionCompletion["status"] | null>(completion?.status ?? null);
  const [rpe, setRpe] = useState<number | null>(completion?.rpe ?? null);
  const [note, setNote] = useState(completion?.note ?? "");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const name = `completion-${sessionId}`;
  const dirty = status !== (completion?.status ?? null) || rpe !== (completion?.rpe ?? null) || note.trim() !== (completion?.note ?? "");

  const save = () =>
    start(async () => {
      if (!status) return;
      const result = await declareCompletion({ sessionId, status, rpe, note: note || null });
      setMessage(result.status === "ok" ? { tone: "success", text: "Enregistré : votre coach voit votre retour." } : { tone: "error", text: result.message });
    });
  const clear = () =>
    start(async () => {
      const result = await clearCompletion(sessionId);
      if (result.status === "ok") {
        setStatus(null);
        setRpe(null);
        setNote("");
        setMessage({ tone: "success", text: "Retour effacé." });
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="text-[13px] font-semibold text-ink-soft">La séance</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {COMPLETION_CHOICES.map((choice) => (
            <label key={choice.value} className="relative">
              <input
                type="radio"
                name={`${name}-status`}
                value={choice.value}
                checked={status === choice.value}
                onChange={() => setStatus(choice.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex h-10 cursor-pointer items-center justify-center rounded-[8px] border border-line-strong bg-surface text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
                  choice.tone,
                )}
              >
                {choice.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-semibold text-ink-soft">
          Effort ressenti <span className="font-normal text-muted">(RPE, de 1 très facile à 10 maximal)</span>
        </legend>
        <div className="mt-1.5 grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
            <label key={value} className="relative">
              <input
                type="radio"
                name={`${name}-rpe`}
                value={value}
                checked={rpe === value}
                onChange={() => setRpe(value)}
                onClick={() => {
                  if (rpe === value) setRpe(null);
                }}
                className="peer sr-only"
              />
              <span className="figure flex h-9 cursor-pointer items-center justify-center rounded-[7px] border border-line-strong bg-surface text-[14px] text-ink-soft hover:bg-surface-2 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-canvas peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
                {value}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${name}-note`} className="text-[13px] font-semibold text-ink-soft">
          Note pour votre coach <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <textarea
          id={`${name}-note`}
          value={note}
          maxLength={500}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Sensations, douleurs, conditions…"
          className={cn(controlClasses, "mt-1.5 min-h-20 py-2")}
        />
        <p className="mt-1 text-right text-[12px] text-muted">{note.length}/500</p>
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!status || pending || !dirty}>
          {pending ? "Enregistrement…" : completion ? "Mettre à jour" : "Enregistrer"}
        </Button>
        {completion ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={clear}>
            Effacer mon retour
          </Button>
        ) : null}
      </div>
    </form>
  );
}
