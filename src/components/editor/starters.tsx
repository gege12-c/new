"use client";

import { Undo2 } from "lucide-react";
import { useMemo } from "react";
import { SPORT_STYLES } from "@/components/sport";
import { computeTotals } from "@/lib/workout/compute";
import { formatDistance, formatDurationShort } from "@/lib/workout/format";
import type { SessionSport } from "@/lib/workout/schema";
import { buildStarter, startersFor, type Starter } from "@/lib/workout/starters";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";

/** Durée de la séance type (distance en natation, où la durée dépend de la CSS). */
function sizeOf(starter: Starter, thresholds?: AthleteThresholds): string | null {
  const totals = computeTotals(buildStarter(starter, thresholds), thresholds);
  if (starter.sport === "swim" && totals.distance.status === "exact") return formatDistance(totals.distance.value, "swim");
  if (totals.duration.status === "exact" || totals.duration.status === "estimated") return formatDurationShort(totals.duration.value);
  return null;
}

/**
 * Séances types de la discipline : un geste remplit le déroulé (cibles adaptées aux seuils de
 * l’athlète), qu’on ajuste ensuite. Un déroulé déjà travaillé se récupère avec « Annuler ».
 */
export function StarterPicker({
  sport,
  thresholds,
  active,
  replaced,
  onPick,
  onUndo,
}: {
  sport: SessionSport;
  thresholds?: AthleteThresholds;
  /** Séance type dont le déroulé est encore intact. */
  active: string | null;
  /** Séance type qui vient de remplacer un déroulé travaillé (« Annuler » le rend). */
  replaced: Starter | null;
  onPick: (starter: Starter) => void;
  onUndo: () => void;
}) {
  const starters = useMemo(() => startersFor(sport).map((starter) => ({ starter, size: sizeOf(starter, thresholds) })), [sport, thresholds]);
  if (!starters.length) return null;
  return (
    <div role="group" aria-labelledby="starters-title">
      <p id="starters-title" className="mb-1.5 text-[13px] font-semibold text-ink-soft">
        Partir d’une séance type
      </p>
      <div className="flex flex-wrap gap-2">
        {starters.map(({ starter, size }) => {
          const on = active === starter.id;
          return (
            <button
              key={starter.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(starter)}
              className={cn(
                "inline-flex h-9 items-baseline gap-1.5 rounded-full border px-3 pt-[7px] text-[13.5px] transition-colors",
                on ? cn("border-transparent font-semibold", SPORT_STYLES[sport].soft, SPORT_STYLES[sport].ink) : "border-line-strong bg-surface text-ink hover:border-ink/40",
              )}
            >
              <span className={on ? undefined : "font-medium"}>{starter.label}</span>
              {size ? <span className={cn("figure text-[12.5px]", on ? "opacity-80" : "text-muted")}>{size}</span> : null}
            </button>
          );
        })}
      </div>
      {replaced ? (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-soft">
          Déroulé remplacé par « {replaced.title} ».
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
          >
            <Undo2 className="size-3.5" aria-hidden />
            Annuler
          </button>
        </p>
      ) : (
        <p className="mt-1.5 text-[12.5px] text-muted">Le déroulé se remplit selon les zones d’entraînement ; tout reste modifiable.</p>
      )}
    </div>
  );
}
