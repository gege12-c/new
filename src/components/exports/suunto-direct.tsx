"use client";

import { AlertTriangle, Check, Info, RotateCcw, Watch, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { pushSessionToSuunto, type SuuntoPushOutcome } from "@/app/(app)/suunto-actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import type { SuuntoGuideState } from "@/lib/data/suunto";
import type { CompatibilityIssue } from "@/lib/export/types";
import { cn } from "@/lib/utils";

export interface SuuntoDirectState {
  /** Le serveur a ses identifiants Suunto. */
  ready: boolean;
  /** Connexion de l'athlète propriétaire de la séance. */
  connection: "active" | "reauth_required" | null;
  /** L'utilisateur est l'athlète (seul lui envoie sur sa montre) ; le coach voit l'état. */
  canPush: boolean;
  guides: SuuntoGuideState[];
  sessionVersion: number;
  multiSegment: boolean;
  segmentLabels: string[];
}

const ORDER = { blocking: 0, loss: 1, info: 2 } as const;

function IssueList({ issues }: { issues: CompatibilityIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {[...issues]
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
        .map((issue, i) => {
          const Icon = issue.severity === "blocking" ? XCircle : issue.severity === "loss" ? AlertTriangle : Info;
          return (
            <li key={i} className="flex gap-2 text-[12.5px] leading-snug">
              <Icon
                aria-hidden
                className={cn(
                  "mt-[2px] size-3.5 shrink-0",
                  issue.severity === "blocking" ? "text-danger" : issue.severity === "loss" ? "text-warning" : "text-muted",
                )}
              />
              <span className={issue.severity === "info" ? "text-muted" : "text-ink-soft"}>
                {issue.where ? <span className="font-medium text-ink">{issue.where} : </span> : null}
                {issue.message}
              </span>
            </li>
          );
        })}
    </ul>
  );
}

/** État des guides envoyés, par partie de séance. */
function GuideStatus({ state, timeZone }: { state: SuuntoDirectState; timeZone: string }) {
  const stamp = (iso: string) =>
    new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));
  const [open, setOpen] = useState(false);
  const live = state.guides.filter((g) => g.status !== "removed");
  if (!live.length)
    return (
      <p className="mt-1 text-[13px] text-muted">Pas encore envoyée sur la montre (les séances publiées des 14 prochains jours partent automatiquement).</p>
    );
  const hasIssues = live.some((g) => g.issues.length);
  return (
    <div className="mt-1 space-y-1">
      {live.map((g) => {
        const part = state.multiSegment ? `${state.segmentLabels[g.segment_index] ?? `Partie ${g.segment_index + 1}`} : ` : "";
        if (g.status === "failed") {
          return (
            <p key={g.segment_index} className="text-[13px] leading-snug text-danger">
              {part}échec de l’envoi{g.last_error ? ` — ${g.last_error}` : ""}. TriCoach réessaie automatiquement.
            </p>
          );
        }
        const stale = g.session_version < state.sessionVersion;
        const losses = g.issues.filter((i) => i.severity === "loss").length;
        return (
          <p key={g.segment_index} className={cn("text-[13px] leading-snug", stale ? "text-warning" : "text-success")}>
            {part}
            {stale
              ? "sur la montre dans une version antérieure (mise à jour en cours)"
              : `sur votre compte Suunto${g.sent_at ? ` depuis le ${stamp(g.sent_at)}` : ""}`}
            {losses ? <span className="text-muted">{` · ${losses} approximation${losses > 1 ? "s" : ""}`}</span> : null}
          </p>
        );
      })}
      {hasIssues ? (
        <details onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-[12.5px] text-muted underline decoration-line-strong underline-offset-4">
            Ce que la montre ne montre pas tel quel
          </summary>
          {open ? live.map((g) => <IssueList key={g.segment_index} issues={g.issues} />) : null}
        </details>
      ) : null}
    </div>
  );
}

/** Envoi direct d'une séance sur la montre Suunto de l'athlète, et état des guides envoyés. */
export function SuuntoDirect({ sessionId, state, timeZone }: { sessionId: string; state: SuuntoDirectState; timeZone: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<SuuntoPushOutcome | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      const result = await pushSessionToSuunto(sessionId);
      setOutcome(result);
      router.refresh();
    });

  if (!state.ready) return null;
  if (!state.connection) {
    return (
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">
        {state.canPush ? (
          <>
            Reliez votre compte Suunto (
            <a href="/athlete/profile#montre-suunto" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
              profil sportif, « Montre Suunto »
            </a>
            ) : vos séances arriveront seules sur la montre.
          </>
        ) : (
          "L’athlète n’a pas relié de compte Suunto : la séance ne part pas sur sa montre."
        )}
      </p>
    );
  }
  return (
    <div className="mt-2" data-suunto-direct>
      {state.connection === "reauth_required" ? (
        <Notice tone="warning">
          {state.canPush
            ? "Suunto a refusé l’accès de TriCoach : reconnectez votre compte depuis le profil sportif pour que vos séances repartent sur la montre."
            : "L’athlète doit reconnecter son compte Suunto pour recevoir cette séance."}
        </Notice>
      ) : null}
      <GuideStatus state={state} timeZone={timeZone} />
      {state.canPush && state.connection === "active" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={send}>
            <Watch aria-hidden />
            {pending ? "Envoi…" : state.guides.some((g) => g.status === "sent") ? "Renvoyer sur ma montre" : "Envoyer sur ma montre"}
          </Button>
          <span className="text-[12.5px] text-muted">Puis ouvrez l’appli Suunto sur votre téléphone pour la synchroniser.</span>
        </div>
      ) : null}
      {outcome && !pending ? (
        <Notice tone={outcome.status === "ok" ? "success" : "error"} className="mt-2">
          <p className="flex gap-2">
            {outcome.status === "ok" ? <Check aria-hidden className="mt-[2px] size-4 shrink-0" /> : null}
            <span>{outcome.message}</span>
          </p>
          {outcome.issues?.length ? <IssueList issues={outcome.issues} /> : null}
          {outcome.status === "error" && state.canPush ? (
            <Button size="sm" variant="secondary" className="mt-2" onClick={send}>
              <RotateCcw aria-hidden />
              Réessayer
            </Button>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}
