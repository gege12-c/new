"use client";

import { CalendarClock, Copy, PencilLine, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSession, duplicateSession, moveSession, publishSession } from "@/app/(app)/planning-actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { controlClasses } from "@/components/ui/field";
import { formatFullDate } from "@/lib/planning/dates";
import { FIELD_LABELS, type EditableField } from "@/lib/planning/snapshot";
import { cn } from "@/lib/utils";

/**
 * Actions du panneau de séance. Le coach planifie (publier, dupliquer, déplacer, supprimer) ;
 * l’athlète peut seulement déplacer les séances de son coach, ce que la base vérifie aussi.
 */
export function PanelActions({
  sessionId,
  date,
  state,
  pending,
  editHref,
  closeHref,
  canPlan,
  canMove,
}: {
  sessionId: string;
  date: string;
  state: string;
  pending: boolean;
  editHref: string | null;
  closeHref: string;
  canPlan: boolean;
  canMove: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "move" | "copy">(null);
  const [target, setTarget] = useState(date);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, startTransition] = useTransition();

  const run = (action: () => Promise<{ status: string; message?: string; fields?: EditableField[] }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.status === "ok") {
        setMessage({ tone: "success", text: success });
        setMode(null);
        after?.();
      } else if (result.status === "conflict") {
        const fields = (result.fields ?? []).map((field) => FIELD_LABELS[field]).join(", ");
        setMessage({
          tone: "error",
          text: `La séance a changé entre-temps${fields ? ` (${fields})` : ""} : rien n’a été modifié. ${
            editHref ? "Ouvrez l’éditeur pour choisir la version à garder." : "Rechargez la page."
          }`,
        });
      } else {
        setMessage({ tone: "error", text: result.message ?? "L’action a échoué." });
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {editHref ? (
          <ButtonLink href={editHref} variant={state === "draft" || pending ? "secondary" : "primary"}>
            <PencilLine aria-hidden />
            Modifier
          </ButtonLink>
        ) : null}
        {canPlan && (state === "draft" || pending) ? (
          <Button onClick={() => run(() => publishSession(sessionId), pending ? "Modifications publiées." : "Séance publiée : l’athlète la voit maintenant.")} disabled={busy}>
            <Send aria-hidden />
            {pending ? "Publier les modifications" : "Publier"}
          </Button>
        ) : null}
        {canMove ? (
          <Button size="md" variant={mode === "move" ? "quiet" : "secondary"} onClick={() => setMode(mode === "move" ? null : "move")} aria-expanded={mode === "move"} className="px-3">
            <CalendarClock aria-hidden />
            Déplacer
          </Button>
        ) : null}
        {canPlan ? (
          <Button size="md" variant={mode === "copy" ? "quiet" : "secondary"} onClick={() => setMode(mode === "copy" ? null : "copy")} aria-expanded={mode === "copy"} className="px-3">
            <Copy aria-hidden />
            Dupliquer
          </Button>
        ) : null}
        {canPlan ? (
          <Button variant="danger" size="icon" className="size-10" onClick={() => setConfirmDelete(true)} aria-label="Supprimer la séance" title="Supprimer la séance">
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>

      {mode ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "move") run(() => moveSession(sessionId, date, target), `Déplacée au ${formatFullDate(target)}.`);
            else run(() => duplicateSession(sessionId, target), `Copiée au ${formatFullDate(target)}.`);
          }}
          className="flex flex-wrap items-end gap-2 rounded-[10px] bg-surface-2 p-3"
        >
          <div className="space-y-1">
            <label htmlFor={`target-${sessionId}`} className="block text-[12px] font-semibold text-ink-soft">
              {mode === "move" ? "Nouvelle date" : "Copier au"}
            </label>
            <input
              id={`target-${sessionId}`}
              type="date"
              value={target}
              onChange={(event) => event.target.value && setTarget(event.target.value)}
              className={cn(controlClasses, "h-9 w-auto")}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || (mode === "move" && target === date)}>
            {mode === "move" ? "Déplacer" : "Dupliquer"}
          </Button>
        </form>
      ) : null}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer cette séance ?"
        confirmLabel="Supprimer"
        pending={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(
            () => deleteSession(sessionId),
            "Séance supprimée.",
            () => {
              setConfirmDelete(false);
              router.push(closeHref, { scroll: false });
            },
          )
        }
      >
        La séance et ses commentaires seront définitivement supprimés{state !== "draft" ? ", et elle disparaîtra du calendrier de l’athlète" : ""}.
      </ConfirmDialog>
    </div>
  );
}
