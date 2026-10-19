import { Panel } from "@/components/ui/panel";
import type { FitnessData } from "@/lib/data/fitness";
import { FITNESS_DAYS, FORM_ZONES, formZone } from "@/lib/stats/fitness";
import { addDays } from "@/lib/planning/dates";
import { signed, ZONE_COLOR } from "@/lib/stats/fitness-format";
import { FitnessChart } from "./fitness-chart";

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Condition physique, fatigue et forme : le réel autorisé jusqu'à aujourd'hui, puis la prévision. */
export function FitnessPanel({ data, viewer }: { data: FitnessData; viewer: "athlete" | "coach" }) {
  const { coverage, current, points } = data;
  const own = viewer === "athlete";
  const hasLoad = points.some((p) => p.load > 0) || (current?.fitness ?? 0) > 0;
  const inAWeek = points.find((p) => p.date === addDays(data.today, 7));
  const zone = current ? formZone(current.form) : null;
  const notes: string[] = [];
  if (!data.realizedAvailable) notes.push("Fichiers FIT et retours de séance : disponibles après la mise à jour de la base de données du site ; seule la prévision est calculée.");
  if (coverage.fitWithoutMeasure) {
    notes.push(
      `${plural(coverage.fitWithoutMeasure, "fichier FIT", "fichiers FIT")} sans mesure exploitable, non ${coverage.fitWithoutMeasure > 1 ? "comptés" : "compté"} : ${
        own ? "renseignez votre FTP, allure seuil, CSS ou FC seuil dans votre profil sportif, ou donnez votre ressenti de la séance" : "il manque un seuil de l’athlète ou son ressenti"
      }.`,
    );
  }
  if (coverage.feedbackWithoutMeasure) {
    notes.push(`${plural(coverage.feedbackWithoutMeasure, "séance faite « en partie » ou sans intensité", "séances faites « en partie » ou sans intensité")} : rien n’est supposé, non ${coverage.feedbackWithoutMeasure > 1 ? "comptées" : "comptée"}.`);
  }
  if (coverage.plannedPartly) {
    notes.push(`${plural(coverage.plannedPartly, "séance prévue a", "séances prévues ont")} des étapes sans intensité : ces étapes ne comptent pas dans la prévision.`);
  }
  if (data.historyDays !== null && data.historyDays < FITNESS_DAYS) {
    notes.push(`La condition se construit sur ${FITNESS_DAYS} jours : avec ${plural(data.historyDays + 1, "jour", "jours")} d’historique, elle est encore sous-estimée.`);
  }

  return (
    <Panel
      title="Condition physique"
      description="Condition : charge d’entraînement moyenne sur 42 jours. Fatigue : sur 7 jours. Forme : la différence des deux. Après aujourd’hui, prévision d’après les séances prévues."
    >
      {hasLoad && current && zone ? (
        <>
          <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="text-[12px] font-semibold text-muted">Condition</dt>
              <dd className="figure text-[26px] leading-tight text-ink">{Math.round(current.fitness)}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-semibold text-muted">Fatigue</dt>
              <dd className="figure text-[26px] leading-tight text-ink">{Math.round(current.fatigue)}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-semibold text-muted">Forme</dt>
              <dd className="figure text-[26px] leading-tight text-ink">
                {signed(current.form)}
                <span className="ml-2 inline-flex items-center gap-1.5 align-middle font-sans text-[13px] font-semibold text-ink-soft">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: ZONE_COLOR[zone.key] }} />
                  {zone.label}
                </span>
              </dd>
            </div>
            {inAWeek?.projected ? (
              <div>
                <dt className="text-[12px] font-semibold text-muted">Dans 7 jours (prévision)</dt>
                <dd className="mt-1 text-[14px] text-ink-soft">
                  Forme <span className="figure font-semibold text-ink">{signed(inAWeek.form)}</span>, {formZone(inAWeek.form).label.toLowerCase()}
                </dd>
              </div>
            ) : null}
          </dl>
          <FitnessChart points={points} today={data.today} />
        </>
      ) : (
        <p className="text-[14px] text-muted">
          {own
            ? "Pas encore de charge à calculer : importez vos fichiers FIT ou donnez votre retour après chaque séance. La prévision apparaît dès que des séances sont prévues."
            : "Pas encore de charge à calculer : aucun fichier FIT ni retour de séance de l’athlète, et aucune séance prévue avec une intensité."}
        </p>
      )}

      <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px] text-ink-soft">
        <p>
          Compté : {plural(coverage.fit, "fichier FIT", "fichiers FIT")}, {plural(coverage.feedback, "retour de séance", "retours de séance")} ; prévision :{" "}
          {plural(coverage.planned, "séance prévue", "séances prévues")}. Les activités Strava ne sont pas comptées (règles de Strava).
        </p>
        {notes.map((note) => (
          <p key={note} className="text-muted">
            {note}
          </p>
        ))}
        <details className="group">
          <summary className="cursor-pointer font-semibold text-ink-soft hover:text-ink">Comment c’est calculé</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>
              Charge d’une séance : heures × intensité² × 100, l’intensité étant rapportée au seuil (puissance normalisée / FTP, vitesse / vitesse au seuil, FC moyenne / FC seuil, ou
              ressenti : RPE 7–8 ≈ seuil). Natation : au cube, comme le sTSS. Une heure au seuil vaut 100.
            </li>
            <li>Condition : moyenne exponentielle de la charge quotidienne sur 42 jours ; fatigue : sur 7 jours ; forme = condition − fatigue.</li>
            <li>
              Zones de forme (Joe Friel) :{" "}
              {FORM_ZONES.map((z, i) => `${z.label.toLowerCase()} ${i === FORM_ZONES.length - 1 ? `sous ${signed(FORM_ZONES[i - 1].min)}` : i === 0 ? `au-dessus de ${signed(z.min)}` : `de ${signed(z.min)} à ${signed(FORM_ZONES[i - 1].min)}`}`).join(", ")}.
            </li>
            <li>Prévision : séances publiées à venir, d’après leurs cibles et les seuils actuels. Une séance non faite ou modifiée fera dévier la courbe.</li>
          </ul>
        </details>
      </div>
    </Panel>
  );
}
