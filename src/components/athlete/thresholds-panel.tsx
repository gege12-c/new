import { deleteThreshold } from "@/app/(app)/actions";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { THRESHOLD_DEFS, currentThresholds, formatThresholdValue, thresholdDef, type ThresholdRow } from "@/lib/thresholds";
import { formatLocalDate } from "@/lib/utils";
import { ThresholdForm } from "./threshold-form";

type Row = ThresholdRow & { id: string };

/** Seuils en vigueur, historique et saisie d'une nouvelle valeur (datée). */
export function ThresholdsPanel({
  athleteId,
  rows,
  today,
  canEdit,
}: {
  athleteId: string;
  rows: Row[];
  today: string;
  canEdit: boolean;
}) {
  const current = currentThresholds(rows, today);
  const groups = [...new Set(THRESHOLD_DEFS.map((d) => d.group))];
  const upcoming = rows.filter((r) => r.effective_from > today);

  return (
    <Panel
      title="Seuils"
      description="Ils servent à convertir les cibles relatives (% FTP, zones, % allure seuil) en valeurs réelles."
    >
      {current.size === 0 ? (
        <EmptyState title="Aucun seuil renseigné">
          Sans FTP, allure seuil ou CSS, les durées et intensités des séances ne pourront pas être calculées.
        </EmptyState>
      ) : (
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {groups.map((group) => {
            const defs = THRESHOLD_DEFS.filter((d) => d.group === group && current.has(d.key));
            if (defs.length === 0) return null;
            return (
              <div key={group}>
                <dt className="text-sm font-medium text-muted">{group}</dt>
                <dd className="mt-1 divide-y divide-line">
                  {defs.map((def) => {
                    const row = current.get(def.key)!;
                    return (
                      <div key={def.key} className="flex items-baseline justify-between gap-4 py-1.5">
                        <span>{def.label}</span>
                        <span className="text-right">
                          <span className="tabular font-semibold">{formatThresholdValue(def, row.value)}</span>
                          <span className="block text-xs text-muted">depuis le {formatLocalDate(row.effective_from)}</span>
                        </span>
                      </div>
                    );
                  })}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {upcoming.length > 0 ? (
        <p className="mt-4 text-sm text-muted">
          {upcoming.length} valeur(s) programmée(s) pour une date future, appliquée(s) automatiquement le moment venu.
        </p>
      ) : null}

      {canEdit ? (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-[15px] font-semibold">Nouvelle valeur</h3>
          <ThresholdForm athleteId={athleteId} today={today} />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <details className="mt-6 border-t border-line pt-4">
          <summary className="cursor-pointer text-sm font-medium text-accent">Historique ({rows.length})</summary>
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => {
              const def = thresholdDef(row.sport, row.metric);
              if (!def) return null;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{def.label}</span> <span className="text-muted">({def.group.toLowerCase()})</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular">{formatThresholdValue(def, row.value)}</span>
                    <span className="hidden text-muted sm:inline">{formatLocalDate(row.effective_from)}</span>
                    {canEdit ? (
                      <form action={deleteThreshold}>
                        <input type="hidden" name="id" value={row.id} />
                        <ConfirmSubmit
                          size="sm"
                          variant="ghost"
                          confirmMessage={`Supprimer la valeur ${formatThresholdValue(def, row.value)} du ${formatLocalDate(row.effective_from)} ?`}
                        >
                          Supprimer
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}
