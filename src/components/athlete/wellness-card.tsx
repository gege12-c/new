"use client";

import { useActionState, useState } from "react";
import { saveWellness } from "@/app/(app)/wellness-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import { formatMeasure, MEASURE_DEFS, MEASURES, SCALE_DEFS, SCALES, type MeasureKey, type ScaleKey, type WellnessEntry } from "@/lib/wellness/wellness";

/** Une échelle de 1 à 5, en boutons radio (au doigt), avec le libellé du niveau choisi. */
function ScaleField({ name, value, onChange }: { name: ScaleKey; value: number | null; onChange: (v: number | null) => void }) {
  const def = SCALE_DEFS[name];
  return (
    <fieldset className="min-w-0">
      <legend className="flex w-full items-baseline justify-between gap-2 text-[13px] font-semibold text-ink-soft">
        {def.label}
        <span className="truncate text-[12.5px] font-medium text-muted">{value ? def.levels[value - 1] : "—"}</span>
      </legend>
      <div className="mt-1.5 grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((level) => {
          const id = `wellness-${name}-${level}`;
          const checked = value === level;
          // Couleur : du meilleur au pire selon le sens de l’échelle (jamais seule porteuse du sens).
          const good = def.higherIsBetter ? level >= 4 : level <= 2;
          const bad = def.higherIsBetter ? level <= 2 : level >= 4;
          return (
            <label
              key={level}
              htmlFor={id}
              className={cn(
                "flex h-10 cursor-pointer items-center justify-center rounded-[8px] border text-[14px] font-semibold transition-colors",
                checked
                  ? bad
                    ? "border-warning bg-warning-soft text-ink"
                    : good
                      ? "border-success bg-success-soft text-ink"
                      : "border-ink bg-surface-3 text-ink"
                  : "border-line-strong bg-surface text-ink-soft hover:bg-surface-2",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={level}
                checked={checked}
                onChange={() => onChange(level)}
                onClick={() => checked && onChange(null)}
                className="sr-only"
                aria-label={`${def.label} : ${def.levels[level - 1]}`}
              />
              {level}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const asText = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));

/**
 * Forme du jour, en dix secondes au réveil : cinq échelles, et si besoin les mesures de la montre
 * (sommeil, FC au repos, VFC) et le poids. Visible des coachs que l’athlète autorise.
 */
export function WellnessCard({ date, entry }: { date: string; entry: WellnessEntry | null }) {
  const [state, action] = useActionState(saveWellness, idle);
  const [editing, setEditing] = useState(entry === null);
  const [scales, setScales] = useState<Record<ScaleKey, number | null>>(() =>
    Object.fromEntries(SCALES.map((k) => [k, entry?.[k] ?? null])) as Record<ScaleKey, number | null>,
  );
  const [measures, setMeasures] = useState<Record<MeasureKey, string>>(() => Object.fromEntries(MEASURES.map((k) => [k, asText(entry?.[k] ?? null)])) as Record<MeasureKey, string>);
  const [note, setNote] = useState(entry?.note ?? "");
  const saved = state.status === "success" && !editing;

  // Enregistrée : retour au résumé (la page relue apporte la ligne du jour). Ajusté pendant le rendu,
  // comme le recommande React pour un état qui découle d’un autre.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success") setEditing(false);
  }

  if (entry && !editing) {
    const parts = [
      ...SCALES.filter((k) => entry[k] !== null).map((k) => `${SCALE_DEFS[k].label} : ${SCALE_DEFS[k].levels[(entry[k] as number) - 1].toLowerCase()}`),
      ...MEASURES.filter((k) => entry[k] !== null).map((k) => `${MEASURE_DEFS[k].label} ${formatMeasure(k, entry[k] as number)}`),
    ];
    return (
      <section aria-labelledby="wellness-title" className="rounded-[14px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="wellness-title" className="heading text-[16px]">
            Forme du jour
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Modifier
          </Button>
        </div>
        <p className="mt-1 text-[14px] text-ink-soft">{parts.join(", ")}.</p>
        {entry.note ? <p className="mt-1 text-[13.5px] text-muted">{entry.note}</p> : null}
        {saved ? <FormMessage state={state} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="wellness-title" className="rounded-[14px] border border-line bg-surface p-4">
      <h2 id="wellness-title" className="heading text-[16px]">
        Forme du jour
      </h2>
      <p className="mt-0.5 text-[13.5px] text-muted">Dix secondes au réveil : votre coach adapte la séance si besoin.</p>
      <form action={action} className="mt-3 space-y-4">
        <input type="hidden" name="entry_date" value={date} />
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {SCALES.map((key) => (
            <ScaleField key={key} name={key} value={scales[key]} onChange={(v) => setScales((s) => ({ ...s, [key]: v }))} />
          ))}
        </div>
        {/* Une échelle laissée vide n’envoie rien : on la remet explicitement à vide. */}
        {SCALES.filter((k) => scales[k] === null).map((k) => (
          <input key={k} type="hidden" name={k} value="" />
        ))}
        <details className="group" open={MEASURES.some((k) => measures[k] !== "")}>
          <summary className="cursor-pointer text-[13px] font-semibold text-ink-soft hover:text-ink">Mesures du matin (facultatif)</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MEASURES.map((key) => (
              <Field key={key} label={`${MEASURE_DEFS[key].label} (${MEASURE_DEFS[key].unit})`} htmlFor={`wellness-${key}`}>
                <Input
                  id={`wellness-${key}`}
                  name={key}
                  inputMode="decimal"
                  value={measures[key]}
                  onChange={(e) => setMeasures((m) => ({ ...m, [key]: e.target.value }))}
                  placeholder={key === "sleep_hours" ? "7,5" : key === "resting_hr" ? "48" : key === "hrv_ms" ? "65" : "72,5"}
                />
              </Field>
            ))}
          </div>
        </details>
        <Field label="Un mot pour votre coach" htmlFor="wellness-note" hint="Facultatif.">
          <Textarea id="wellness-note" name="note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
        </Field>
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton>Enregistrer</SubmitButton>
          {entry ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
