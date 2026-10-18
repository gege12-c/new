"use client";

import { Lock, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { addComment, deleteComment } from "@/app/(app)/planning-actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { controlClasses } from "@/components/ui/field";
import type { SessionComment } from "@/lib/data/planning-types";
import { cn, initials } from "@/lib/utils";

/** Fil de commentaires d’une séance. Les notes privées du coach ne sont jamais montrées à l’athlète. */
export function CommentsThread({
  sessionId,
  comments,
  currentUserId,
  canWritePrivate,
  timeZone,
}: {
  sessionId: string;
  comments: SessionComment[];
  currentUserId: string;
  canWritePrivate: boolean;
  timeZone: string;
}) {
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const format = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

  return (
    <div className="space-y-4">
      {comments.length ? (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <span aria-hidden className="figure flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] text-ink-soft">
                {initials(comment.author_name)}
              </span>
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-[12px] px-3 py-2",
                  comment.visibility === "coach_private" ? "border border-dashed border-line-strong bg-surface" : "bg-surface-2",
                )}
              >
                <p className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <span className="font-semibold text-ink">{comment.author_name}</span>
                  <span className="text-muted">{format(comment.created_at)}</span>
                  {comment.edited_at ? <span className="text-muted">modifié</span> : null}
                  {comment.visibility === "coach_private" ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-ink-soft">
                      <Lock className="size-3" aria-hidden />
                      Note privée
                    </span>
                  ) : null}
                  {comment.author_id === currentUserId ? (
                    <button
                      type="button"
                      aria-label="Supprimer ce commentaire"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await deleteComment(comment.id);
                          if (result.status === "error") setError(result.message);
                        })
                      }
                      className="ml-auto text-muted hover:text-danger"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-[14px] leading-relaxed text-ink">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">Aucun commentaire pour l’instant.</p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await addComment({ sessionId, body, visibility: isPrivate ? "coach_private" : "shared" });
            if (result.status === "ok") {
              setBody("");
              setIsPrivate(false);
            } else {
              setError(result.message);
            }
          });
        }}
        className="space-y-2"
      >
        <label htmlFor={`comment-${sessionId}`} className="sr-only">
          Votre commentaire
        </label>
        <textarea
          id={`comment-${sessionId}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder={canWritePrivate ? "Un retour pour l’athlète, ou une note privée…" : "Sensations, contraintes, questions…"}
          className={cn(controlClasses, "min-h-20 py-2 text-[14px] leading-relaxed")}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canWritePrivate ? (
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} className="size-4 accent-[var(--ink)]" />
              Note privée (invisible pour l’athlète)
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            {pending ? "Envoi…" : isPrivate ? "Ajouter la note" : "Commenter"}
          </Button>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </form>
    </div>
  );
}
