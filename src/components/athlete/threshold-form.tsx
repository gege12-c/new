"use client";

import { useActionState, useState } from "react";
import { addThreshold } from "@/app/(app)/actions";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle, type ActionState } from "@/lib/action-state";
import { parsePace, THRESHOLD_DEFS } from "@/lib/thresholds";
import { formatClock } from "@/lib/workout/format";
import { cssFromTests, ftpFromTwentyMinutes } from "@/lib/workout/zone-table";

/**
 * Nouvelle valeur d'un seuil. Champs contrôlés : après une erreur, la saisie et la date restent en
 * place (React remet à zéro les champs libres d'un formulaire à chaque envoi) ; après un succès, la
 * valeur est vidée et la date gardée, pour enchaîner les seuils d'un même test.
 */
export function ThresholdForm({ athleteId, today }: { athleteId: string; today: string }) {
  const [key, setKey] = useState(THRESHOLD_DEFS[0].key);
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(today);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await addThreshold(previous, formData);
    if (result.status === "success") setValue("");
    return result;
  }, idle);
  const def = THRESHOLD_DEFS.find((d) => d.key === key) ?? THRESHOLD_DEFS[0];
  const groups = [...new Set(THRESHOLD_DEFS.map((d) => d.group))];
  const report = (thresholdKey: string, reported: string) => {
    setKey(thresholdKey);
    setValue(reported);
    document.getElementById("threshold-value")?.focus();
  };

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="athlete_id" value={athleteId} />
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field label="Seuil" htmlFor="threshold-key">
            <Select
              id="threshold-key"
              name="key"
              value={key}
              onChange={(e) => {
                // Une valeur tapée pour un autre seuil n'a pas la même unité.
                setKey(e.target.value);
                setValue("");
              }}
            >
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {THRESHOLD_DEFS.filter((d) => d.group === group).map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label} ({d.unit})
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label={`Valeur (${def.unit})`} htmlFor="threshold-value" hint={def.help}>
            <Input
              id="threshold-value"
              name="value"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder={def.input === "pace" ? "4,10" : undefined}
              className="tabular"
            />
          </Field>
          <Field label="À partir du" htmlFor="threshold-date">
            <Input id="threshold-date" name="effective_from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
        </div>
        <FormMessage state={state} />
        <SubmitButton size="sm" variant="secondary">
          Enregistrer le seuil
        </SubmitButton>
      </form>
      <TestCalculators onReport={report} />
    </div>
  );
}

/**
 * Seuils tirés d'un test, à reporter dans le formulaire (rien n'est enregistré sans « Enregistrer ») :
 * FTP d'un test de 20 minutes, CSS d'un test 400 m + 200 m ; la méthode de course est rappelée.
 */
function TestCalculators({ onReport }: { onReport: (key: string, value: string) => void }) {
  const [watts, setWatts] = useState("");
  const [t400, setT400] = useState("");
  const [t200, setT200] = useState("");
  const ftp = watts.trim() ? ftpFromTwentyMinutes(Number(watts.replace(",", "."))) : null;
  const s400 = t400.trim() ? parsePace(t400) : null;
  const s200 = t200.trim() ? parsePace(t200) : null;
  const css = s400 !== null && s200 !== null ? cssFromTests(s400, s200) : null;
  const cssProblem = t400.trim() && t200.trim() && css === null ? "Temps à vérifier : format m:ss, et le 400 m plus long que le 200 m." : null;

  return (
    <details className="rounded-[12px] border border-line">
      <summary className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold text-ink-soft hover:text-ink">Calculer depuis un test</summary>
      <div className="grid gap-5 border-t border-line p-3 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[13.5px] font-semibold text-ink">Vélo : test de 20 minutes</p>
          <p className="text-[12.5px] leading-snug text-muted">Après un bon échauffement, 20 minutes au maximum tenable. FTP = 95 % de la puissance moyenne.</p>
          <Field label="Puissance moyenne sur 20 min (W)" htmlFor="test-20min">
            <Input id="test-20min" inputMode="decimal" autoComplete="off" value={watts} onChange={(e) => setWatts(e.target.value)} className="tabular" />
          </Field>
          {ftp ? (
            <button
              type="button"
              onClick={() => onReport("bike.ftp_w", String(ftp))}
              className="text-[13px] font-semibold text-ink underline underline-offset-4 hover:decoration-2"
            >
              Reporter une FTP de {ftp} W
            </button>
          ) : watts.trim() ? (
            <p className="text-[12.5px] text-danger">Puissance à vérifier (de 40 à 750 W).</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="text-[13.5px] font-semibold text-ink">Natation : test 400 m + 200 m</p>
          <p className="text-[12.5px] leading-snug text-muted">
            Un 400 m puis, après récupération, un 200 m, à fond. CSS = (temps du 400 − temps du 200) ÷ 2, par 100 m.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Temps du 400 m" htmlFor="test-400">
              <Input id="test-400" autoComplete="off" placeholder="6:20" value={t400} onChange={(e) => setT400(e.target.value)} className="tabular" />
            </Field>
            <Field label="Temps du 200 m" htmlFor="test-200">
              <Input id="test-200" autoComplete="off" placeholder="3:02" value={t200} onChange={(e) => setT200(e.target.value)} className="tabular" />
            </Field>
          </div>
          {css ? (
            <button
              type="button"
              onClick={() => onReport("swim.css_s_per_100m", formatClock(css))}
              className="text-[13px] font-semibold text-ink underline underline-offset-4 hover:decoration-2"
            >
              Reporter une CSS de {formatClock(css)} /100 m
            </button>
          ) : cssProblem ? (
            <p className="text-[12.5px] text-danger">{cssProblem}</p>
          ) : null}
        </div>
        <p className="text-[12.5px] leading-snug text-muted sm:col-span-2">
          Course : 30 minutes seul, au maximum tenable ; l’allure moyenne et la FC moyenne des 20 dernières minutes sont votre allure seuil et votre FC au seuil
          (méthode de Joe Friel). Saisissez-les directement ci-dessus.
        </p>
      </div>
    </details>
  );
}
