import type { EffortComparison, EffortRow } from "@/lib/activities/efforts";
import { formatDuration } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

function verdictText(row: EffortRow): { text: string; className: string } {
  if (row.verdict === "in") return { text: "dans la cible", className: "text-success" };
  if (row.verdict === "above") return { text: row.metric === "pace" ? "plus rapide" : "au-dessus", className: "text-warning" };
  if (row.verdict === "below") return { text: row.metric === "pace" ? "plus lent" : "en dessous", className: "text-warning" };
  return { text: "—", className: "text-muted" };
}

/** Efforts prévus face aux efforts réalisés, dans l'ordre, avec la cible tenue ou non. */
export function EffortsTable({ comparison, id }: { comparison: EffortComparison; id: string }) {
  const { rows, planned, detected } = comparison;
  const judged = rows.filter((r) => r.verdict !== "unknown");
  const hit = judged.filter((r) => r.verdict === "in").length;
  const titleId = `efforts-${id}`;
  return (
    <section aria-labelledby={titleId} className="rounded-[12px] border border-line">
      <div className="px-3 pb-2 pt-2.5">
        <h4 id={titleId} className="text-[14px] font-semibold text-ink">
          Efforts prévus et réalisés
        </h4>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
          {judged.length
            ? `${hit} sur ${judged.length} dans la cible, à 2 % près.`
            : "Cibles non comparées : seuil de l’athlète manquant, ou mesure absente de l’activité."}
          {planned !== detected ? ` ${planned} effort${planned > 1 ? "s" : ""} prévu${planned > 1 ? "s" : ""}, ${detected} réalisé${detected > 1 ? "s" : ""} : comparés dans l’ordre.` : ""}
        </p>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <thead>
            <tr className="text-[11.5px] text-muted">
              <th scope="col" className="px-3 py-1.5 font-medium">
                <span className="sr-only">Effort</span>
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Prévu</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Réalisé</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Cible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const verdict = verdictText(row);
              return (
                <tr key={row.rank}>
                  <th scope="row" className="px-3 py-1.5 font-semibold text-ink">
                    Effort {row.rank}
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
                  <td className="figure py-1.5 pr-2 text-ink-soft">
                    {row.actual ? (
                      <>
                        {formatDuration(row.actual.durationS)}
                        {row.actual.value ? <span className="font-semibold text-ink">, {row.actual.value}</span> : null}
                      </>
                    ) : (
                      <span className="text-muted">non détecté</span>
                    )}
                  </td>
                  <td className={cn("py-1.5 pr-3 font-semibold", verdict.className)}>{verdict.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
