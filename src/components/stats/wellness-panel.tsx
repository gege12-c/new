import Link from "next/link";
import { EmptyState } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { addDays, dateRange } from "@/lib/planning/dates";
import { cn } from "@/lib/utils";
import { formatMeasure, MEASURE_DEFS, MEASURES, SCALE_DEFS, SCALES, type ScaleKey, type WellnessEntry } from "@/lib/wellness/wellness";

/** Fenêtre affichée, et nombre de jours renseignés en dessous duquel rien n'est tracé. */
export const WELLNESS_DAYS = 28;
const MIN_POINTS = 3;
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** Une ligne de 28 cases par échelle : du mieux (clair) au moins bien (marqué), vide si non renseigné. */
function ScaleRow({ scale, days, byDay }: { scale: ScaleKey; days: string[]; byDay: Map<string, WellnessEntry> }) {
  const def = SCALE_DEFS[scale];
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
      <span className="text-[13px] font-semibold text-ink-soft">{def.label}</span>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const value = byDay.get(day)?.[scale] ?? null;
          // Gêne de 0 (au mieux) à 4 (au pire), quel que soit le sens de l'échelle.
          const strain = value === null ? null : def.higherIsBetter ? 5 - value : value - 1;
          return (
            <span
              key={day}
              title={`${shortDate(day)} : ${value === null ? "non renseigné" : def.levels[value - 1]}`}
              className={cn(
                "h-5 rounded-[3px]",
                strain === null && "border border-dashed border-line",
                strain === 0 && "bg-success/25",
                strain === 1 && "bg-success/45",
                strain === 2 && "bg-surface-3",
                strain === 3 && "bg-warning/55",
                strain === 4 && "bg-warning",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Forme des 28 derniers jours : mesures du matin et échelles, sans rien tracer sur trop peu de jours. */
export function WellnessPanel({ entries, today, viewer }: { entries: WellnessEntry[] | null; today: string; viewer: "athlete" | "coach" }) {
  const days = dateRange(addDays(today, -(WELLNESS_DAYS - 1)), today);
  const byDay = new Map((entries ?? []).map((e) => [e.entry_date, e]));
  const filled = days.filter((d) => byDay.has(d)).length;
  return (
    <Panel
      title="Forme du jour"
      description={`Ressenti du matin (sommeil, fatigue, courbatures, stress, motivation) sur ${WELLNESS_DAYS} jours ; les mesures de la montre sont dans « Mesures du matin ».`}
    >
      {entries === null ? (
        <p className="text-[14px] text-muted">Disponible après la mise à jour de la base de données du site.</p>
      ) : filled < MIN_POINTS ? (
        <EmptyState title={filled ? `${filled} jour${filled > 1 ? "s" : ""} renseigné${filled > 1 ? "s" : ""} sur ${WELLNESS_DAYS}` : "Pas encore de forme du jour"}>
          {viewer === "athlete" ? (
            <>
              Elle se saisit en dix secondes sur{" "}
              <Link href="/athlete" className="font-semibold text-ink underline decoration-line-strong underline-offset-4">
                l’accueil
              </Link>
              , chaque matin. Les tendances s’affichent à partir de 3 jours.
            </>
          ) : (
            "L’athlète la saisit sur son accueil, chaque matin. Les tendances s’affichent à partir de 3 jours renseignés."
          )}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            {SCALES.map((s) => (
              <ScaleRow key={s} scale={s} days={days} byDay={byDay} />
            ))}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[108px] text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-[3px] bg-success/45" aria-hidden /> bien
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-[3px] bg-surface-3" aria-hidden /> normal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-[3px] bg-warning" aria-hidden /> moins bien
              </span>
              <span>
                du {shortDate(days[0])} au {shortDate(today)}, {filled} jours renseignés
              </span>
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">Voir le tableau</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12.5px]">
                <thead className="text-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Jour
                    </th>
                    {SCALES.map((s) => (
                      <th key={s} scope="col" className="py-1.5 pr-3 font-medium">
                        {SCALE_DEFS[s].label}
                      </th>
                    ))}
                    {MEASURES.map((m) => (
                      <th key={m} scope="col" className="py-1.5 pr-3 font-medium">
                        {MEASURE_DEFS[m].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-ink">
                  {[...days]
                    .reverse()
                    .filter((d) => byDay.has(d))
                    .map((d) => {
                      const e = byDay.get(d)!;
                      return (
                        <tr key={d}>
                          <th scope="row" className="py-1.5 pr-3 font-medium">
                            {shortDate(d)}
                          </th>
                          {SCALES.map((s) => (
                            <td key={s} className="py-1.5 pr-3">
                              {e[s] === null ? "—" : SCALE_DEFS[s].levels[(e[s] as number) - 1]}
                            </td>
                          ))}
                          {MEASURES.map((m) => (
                            <td key={m} className="figure py-1.5 pr-3">
                              {e[m] === null ? "—" : formatMeasure(m, Number(e[m]))}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}
