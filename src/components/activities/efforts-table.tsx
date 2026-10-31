import { SHORT_STEP_S, type EffortComparison, type EffortRow } from "@/lib/activities/efforts";
import { formatDuration } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

function verdictText(row: EffortRow): { text: string; className: string } {
  if (row.verdict === "in") return { text: "dans la cible", className: "text-success" };
  if (row.verdict === "above") return { text: row.metric === "pace" ? "plus rapide" : "au-dessus", className: "text-warning" };
  if (row.verdict === "below") return { text: row.metric === "pace" ? "plus lent" : "en dessous", className: "text-warning" };
  return { text: "—", className: "text-muted" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Séance prévue face à la séance faite, étape par étape, avec la cible tenue ou non. */
export function EffortsTable({ comparison, id }: { comparison: EffortComparison; id: string }) {
  const { rows, planned, detected, method } = comparison;
  const judged = rows.filter((r) => r.verdict !== "unknown");
  const hit = judged.filter((r) => r.verdict === "in").length;
  const short = rows.some((r) => r.actual && r.actual.durationS < SHORT_STEP_S && r.verdict !== "unknown");
  const titleId = `efforts-${id}`;
  return (
    <section aria-labelledby={titleId} className="rounded-[12px] border border-line">
      <div className="px-3 pb-2 pt-2.5">
        <h4 id={titleId} className="text-[14px] font-semibold text-ink">
          {method === "streams" ? "Prévu et réalisé, étape par étape" : "Efforts prévus et réalisés"}
        </h4>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
          {judged.length
            ? `${hit} ${method === "streams" ? "étape" : "effort"}${hit > 1 ? "s" : ""} sur ${judged.length} dans la cible, à 2 % près${short ? " (5 % pour les étapes de moins d’une minute, mesurées sur peu de mètres)" : ""}.`
            : "Cibles non comparées : seuil de l’athlète manquant, ou mesure absente de l’activité."}
          {planned !== detected ? ` ${plural(planned, "effort prévu", "efforts prévus")}, ${plural(detected, "retrouvé", "retrouvés")}.` : ""}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-muted">
          {method === "streams"
            ? "Étapes retrouvées sur les courbes de la séance, chaque changement d’allure ou de puissance recalé à la seconde près ; allure tirée de la distance GPS."
            : "Efforts pris dans les tours de la séance, dans l’ordre : les courbes ne permettent pas de retrouver les étapes."}
        </p>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[320px] text-left text-[13px]">
          <thead>
            <tr className="text-[11.5px] text-muted">
              <th scope="col" className="px-3 py-1.5 font-medium">
                <span className="sr-only">Étape</span>
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Prévu</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Réalisé et cible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const verdict = verdictText(row);
              return (
                <tr key={row.rank} className={row.effort ? undefined : "text-[12.5px]"}>
                  <th scope="row" className={cn("whitespace-nowrap px-3 py-1.5", row.effort ? "font-semibold text-ink" : "font-medium text-ink-soft")}>
                    {row.name}
                  </th>
                  <td className="figure py-1.5 pr-2 text-ink-soft">
                    {row.planned ? (
                      <>
                        {row.planned.length}
                        {row.planned.target ? <span className="text-ink">, {row.planned.target}</span> : null}
                      </>
                    ) : (
                      <span className="text-muted">non prévu</span>
                    )}
                  </td>
                  <td className="figure py-1.5 pr-3 text-ink-soft">
                    {row.actual ? (
                      <>
                        {formatDuration(row.actual.durationS)}
                        {row.actual.value ? <span className="font-semibold text-ink">, {row.actual.value}</span> : null}
                        {row.verdict !== "unknown" ? <span className={cn("block font-sans text-[12px] font-semibold", verdict.className)}>{verdict.text}</span> : null}
                        {row.actual.partial ? <span className="block font-sans text-[11.5px] text-warning">écourté : l’activité s’arrête avant</span> : null}
                      </>
                    ) : (
                      <span className="text-muted">non fait</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
