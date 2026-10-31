"use client";

import { Type } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { controlClasses } from "@/components/ui/field";
import { summarizeNodes } from "@/lib/workout/format";
import type { SegmentSport, Workout } from "@/lib/workout/schema";
import { parseWorkoutText } from "@/lib/workout/text";
import { cn } from "@/lib/utils";

const EXAMPLES: Partial<Record<SegmentSport, string>> = {
  bike: "Échauffement\n- 15m 55-70%\n\n4x Seuil\n- 8m 95-105% 85-95rpm\n- 3m Z1 récup\n\n- 10m 60% Retour au calme",
  run: "- 15m Z2 HR Échauffement\n\n6x\n- 400mtr 3:50-4:00/km\n- 90s RPE 2 récup\n\n- 10m Z1 HR Retour au calme",
  swim: "- 400m Échauffement\n\n8x\n- 100m 1:40/100m\n- 20s repos\n\n- 200m souple Retour au calme",
};

/**
 * Écrire le déroulé en texte, à la manière d’intervals.icu : aperçu immédiat de ce qui est compris,
 * problèmes ligne par ligne, puis remplacement du déroulé (rien n’est appliqué sans le bouton).
 */
export function TextWorkoutButton({ sport, onApply }: { sport: SegmentSport; onApply: (workout: Workout) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const result = useMemo(() => (text.trim() ? parseWorkoutText(text, sport) : null), [text, sport]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        <Type className="size-3.5" aria-hidden />
        Écrire en texte
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Écrire le déroulé en texte" className="w-[min(640px,calc(100vw-32px))]">
        <div className="space-y-3">
          <p className="text-[13.5px] text-ink-soft">
            Une étape par ligne, commençant par un tiret : durée ou distance (15m, 1h30m, 45s, 2km, 400mtr), puis la cible (95%, 220w, Z2, Z2 HR, 4:30/km,
            1:40/100m, 150bpm, 90% LTHR, RPE 6) et un intitulé libre. « 4x » répète les lignes suivantes jusqu’à la ligne vide. Une ligne sans tiret nomme les
            étapes qui suivent.
          </p>
          <label htmlFor="workout-text" className="sr-only">
            Déroulé en texte
          </label>
          <textarea
            id="workout-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={EXAMPLES[sport] ?? "- 10m RPE 3 Échauffement\n- 30m RPE 6\n- 10m RPE 3 Retour au calme"}
            className={cn(controlClasses, "py-2 font-mono text-[13.5px] leading-relaxed")}
          />
          {result ? (
            <div aria-live="polite" className="space-y-2">
              {result.issues.length ? (
                <Notice tone="warning">
                  <ul className="space-y-0.5">
                    {result.issues.map((issue, i) => (
                      <li key={i}>{issue.line ? `Ligne ${issue.line} : ${issue.message}` : issue.message}</li>
                    ))}
                  </ul>
                </Notice>
              ) : null}
              {result.workout ? (
                <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13.5px] text-ink">
                  <span className="font-semibold">Compris : </span>
                  {summarizeNodes(result.workout.segments[0].steps, sport)}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!text ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setText(EXAMPLES[sport] ?? "")} disabled={!EXAMPLES[sport]}>
                Partir d’un exemple
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                type="button"
                disabled={!result?.workout}
                onClick={() => {
                  if (!result?.workout) return;
                  onApply(result.workout);
                  setOpen(false);
                  setText("");
                }}
              >
                Remplacer le déroulé
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
