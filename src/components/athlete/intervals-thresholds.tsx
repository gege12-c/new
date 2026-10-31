"use client";

import { ArrowRightLeft, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { alignThresholdsAction, compareThresholdsAction, importIntervalsThresholdAction, type ThresholdsView } from "@/app/(app)/device-actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/**
 * Seuils de TriCoach et d'intervals.icu côte à côte : intervals.icu s'en sert pour la FC des
 * séances (en % du seuil ou en zones), la charge et la forme. TriCoach fait référence : un geste
 * aligne intervals.icu ; une valeur d'intervals.icu peut aussi être reprise dans TriCoach.
 */
export function IntervalsThresholds() {
  const [view, setView] = useState<ThresholdsView | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<ThresholdsView>) =>
    start(async () => {
      setView(await action().catch(() => ({ status: "error" as const, message: "La demande n’a pas abouti : vérifiez votre connexion, puis réessayez." })));
    });

  const lines = view?.status === "ok" ? view.lines : [];
  const alignable = lines.filter((line) => !line.same && line.tricoach !== null && !line.noSettings).length;

  return (
    <section aria-labelledby="icu-thresholds-title" className="space-y-3 rounded-[12px] bg-surface-2 p-3">
      <div>
        <h4 id="icu-thresholds-title" className="text-[14px] font-semibold text-ink">
          Mêmes seuils des deux côtés
        </h4>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">
          intervals.icu s’en sert pour la fréquence cardiaque des séances, la charge et la forme. TriCoach fait référence.
        </p>
      </div>

      {view === null ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(compareThresholdsAction)}>
          <ArrowRightLeft aria-hidden />
          {pending ? "Lecture chez intervals.icu…" : "Comparer avec intervals.icu"}
        </Button>
      ) : view.status === "error" ? (
        <div className="space-y-2">
          <Notice tone="error">{view.message}</Notice>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(compareThresholdsAction)}>
            <RefreshCw aria-hidden />
            Réessayer
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {lines.length ? (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th scope="col" className="pb-1 font-semibold">
                    Seuil
                  </th>
                  <th scope="col" className="pb-1 font-semibold">
                    TriCoach
                  </th>
                  <th scope="col" className="pb-1 font-semibold">
                    intervals.icu
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((line) => (
                  <tr key={line.id} data-threshold-line={line.id} className="align-top">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink-soft">
                      {line.label}
                    </th>
                    <td className="figure whitespace-nowrap py-1.5 pr-2 text-ink">{line.tricoach ?? <span className="text-muted">—</span>}</td>
                    <td className="py-1.5">
                      <span className={cn("figure whitespace-nowrap", line.same ? "text-ink" : "font-semibold text-warning")}>
                        {line.intervals ?? (line.noSettings ? <span className="font-normal text-muted">pas de réglage</span> : <span className="text-muted">—</span>)}
                      </span>
                      {!line.same && line.intervals !== null ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => importIntervalsThresholdAction(line.id))}
                          className="block text-[12.5px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-50"
                          aria-label={`${line.label} : reprendre la valeur d’intervals.icu dans TriCoach`}
                        >
                          Reprendre
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-muted">Aucun seuil de part et d’autre : renseignez les vôtres dans la rubrique Seuils.</p>
          )}
          {view.message ? <Notice tone={view.tone === "warning" ? "warning" : "success"}>{view.message}</Notice> : null}
          {alignable ? (
            <Button size="sm" disabled={pending} onClick={() => run(alignThresholdsAction)}>
              <ArrowRightLeft aria-hidden />
              {pending ? "Envoi…" : `Envoyer mes seuils à intervals.icu (${alignable})`}
            </Button>
          ) : lines.length && !view.message ? (
            <p className="text-[13px] font-semibold text-success">Mêmes seuils des deux côtés.</p>
          ) : null}
          {alignable ? (
            <p className="text-[12px] leading-snug text-muted">
              Seules les valeurs différentes changent chez intervals.icu ; quand une FC change, il recalcule ses zones de FC. Rien n’y est effacé. « Reprendre »
              garde au contraire la valeur d’intervals.icu dans TriCoach, à partir d’aujourd’hui.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
