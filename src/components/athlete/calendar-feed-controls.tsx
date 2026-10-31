"use client";

import { Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createCalendarFeed, revokeCalendarFeed } from "@/app/(app)/calendar-feed-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/feedback";
import { idle, type ActionState } from "@/lib/action-state";

/**
 * Création (ou remplacement) et retrait de l'adresse d'agenda. L'adresse n'est montrée qu'une fois,
 * juste après sa création : elle contient le secret qui ouvre l'agenda.
 */
export function CalendarFeedControls({ exists }: { exists: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(idle);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);

  const create = () =>
    start(async () => {
      const result = await createCalendarFeed();
      setConfirm(null);
      setState(result);
      setUrl(result.data?.url ?? null);
      setCopied(false);
    });
  const revoke = () =>
    start(async () => {
      const result = await revokeCalendarFeed();
      setConfirm(null);
      setState(result);
      setUrl(null);
    });
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3">
      {url ? (
        <div className="space-y-2 rounded-[12px] border border-line-strong bg-surface-2/60 p-3">
          <p className="text-[13px] font-semibold text-ink">Votre adresse d’agenda (affichée une seule fois)</p>
          <input
            readOnly
            value={url}
            aria-label="Adresse d’abonnement de l’agenda"
            onFocus={(e) => e.currentTarget.select()}
            className="block w-full rounded-[8px] border border-line-strong bg-surface px-3 py-2 font-mono text-[12.5px] text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copiée" : "Copier l’adresse"}
            </Button>
            <a
              href={url.replace(/^https?:/, "webcal:")}
              className="inline-flex h-8 items-center rounded-[8px] border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              S’abonner (iPhone, Mac, Outlook)
            </a>
          </div>
          <p className="text-[12.5px] text-muted">Ne la partagez pas : elle suffit à lire vos séances. Si elle vous échappe, remplacez-la.</p>
        </div>
      ) : null}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {exists || url ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirm("replace")} disabled={pending}>
              <RefreshCw aria-hidden />
              Nouvelle adresse
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm("revoke")} disabled={pending}>
              <Trash2 aria-hidden />
              Retirer
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={create} disabled={pending}>
            Créer l’adresse de mon agenda
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "revoke" ? "Retirer l’adresse de l’agenda ?" : "Remplacer l’adresse de l’agenda ?"}
        confirmLabel={confirm === "revoke" ? "Retirer" : "Remplacer"}
        tone={confirm === "revoke" ? "danger" : "primary"}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={confirm === "revoke" ? revoke : create}
      >
        {confirm === "revoke"
          ? "Votre agenda ne recevra plus vos séances ; vous pourrez en créer une nouvelle."
          : "L’ancienne adresse cessera aussitôt de fonctionner : abonnez votre agenda à la nouvelle."}
      </ConfirmDialog>
    </div>
  );
}
