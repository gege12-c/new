import { Info } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { ADHERENCE_WEEKS, INTENSITY_WEEKS, VOLUME_WEEKS, type StatsData } from "@/lib/data/stats";
import { INTENSITY_BANDS, MIN_INTENSITY_SECONDS, MIN_INTENSITY_SESSIONS, STAT_SPORTS, type RecordEntry, type ThresholdSeries } from "@/lib/stats/stats";
import { THRESHOLD_DEFS, formatThresholdValue } from "@/lib/thresholds";
import { formatClock, formatDistance, formatDurationShort } from "@/lib/workout/format";
import { cn } from "@/lib/utils";
import { SPORT_FILL, SPORT_NAME } from "@/lib/stats/labels";
import { FitnessPanel } from "./fitness-panel";
import { VolumeChart } from "./volume-chart";

const BAND_FILL = ["bg-zone-1", "bg-zone-2", "bg-zone-3", "bg-zone-4", "bg-zone-5", "bg-zone-6"];
const dayMonth = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const dayMonthYear = (iso: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const percent = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} %`;

/** Graphique minimal d'un seuil dans le temps (marches : une valeur vaut jusqu'à la suivante). */
function Sparkline({ points, invert, today }: { points: { date: string; value: number }[]; invert: boolean; today: string }) {
  const width = 240;
  const height = 56;
  const pad = 5;
  const t = (date: string) => Date.parse(`${date}T12:00:00Z`);
  const start = t(points[0].date);
  const end = Math.max(t(today), t(points[points.length - 1].date) + 86_400_000);
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (date: string) => pad + ((t(date) - start) / (end - start)) * (width - 2 * pad);
  const y = (value: number) => {
    const ratio = (value - min) / span;
    return pad + (invert ? ratio : 1 - ratio) * (height - 2 * pad);
  };
  let d = `M ${x(points[0].date)} ${y(points[0].value)}`;
  for (let i = 1; i < points.length; i += 1) d += ` H ${x(points[i].date)} V ${y(points[i].value)}`;
  d += ` H ${width - pad}`;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full text-ink-soft" role="img" aria-hidden preserveAspectRatio="none">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={width - pad} cy={y(last.value)} r={4} className="fill-ink stroke-surface" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ThresholdTile({ series, today }: { series: ThresholdSeries; today: string }) {
  const def = THRESHOLD_DEFS.find((d) => d.key === series.key)!;
  const { points } = series;
  const pace = def.input === "pace";
  const last = points[points.length - 1];
  const first = points[0];
  // Allures : une baisse de secondes est un progrès.
  const delta = points.length > 1 ? last.value - first.value : null;
  const better = delta === null || delta === 0 ? null : pace ? delta < 0 : def.metric === "ftp_w" ? delta > 0 : null;
  const deltaText = delta === null || delta === 0 ? null : pace ? `${delta < 0 ? "−" : "+"}${formatClock(Math.abs(delta))}` : `${delta > 0 ? "+" : "−"}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Math.abs(delta))} ${def.unit}`;
  return (
    <div className="rounded-[12px] border border-line p-3">
      <p className="text-[12.5px] font-semibold text-ink-soft">
        {def.label} <span className="font-normal text-muted">· {def.group.toLowerCase()}</span>
      </p>
      {last ? (
        <>
          <p className="figure mt-1 text-[22px] leading-tight text-ink">{formatThresholdValue(def, last.value)}</p>
          <p className="text-[12px] text-muted">
            depuis le {dayMonthYear(last.date)}
            {deltaText ? (
              <>
                {" · "}
                <span className={cn("font-semibold", better === true ? "text-success" : better === false ? "text-warning" : "text-ink-soft")}>{deltaText}</span> depuis le {dayMonth(first.date)}
              </>
            ) : null}
          </p>
          {points.length > 1 ? <Sparkline points={points} invert={pace} today={today} /> : <p className="mt-2 text-[12px] text-muted">Une seule valeur enregistrée : l’évolution apparaîtra à la prochaine mise à jour.</p>}
        </>
      ) : (
        <p className="mt-1 text-[13px] text-muted">Non renseigné.</p>
      )}
    </div>
  );
}

function recordValue(record: RecordEntry, sport: string) {
  switch (record.unit) {
    case "duration":
      return formatDurationShort(record.value);
    case "distance":
      return formatDistance(record.value, sport === "swim" ? "swim" : undefined);
    case "watts":
      return `${Math.round(record.value)} W`;
    case "pace_km":
      return `${formatClock(record.value)} /km`;
    case "pace_100m":
      return `${formatClock(record.value)} /100 m`;
  }
}

/** Progression d'un athlète : volumes, intensité prévue, suivi des séances, seuils et records. */
export function StatsView({ data, today, viewer, canSeeFiles }: { data: StatsData; today: string; viewer: "athlete" | "coach"; canSeeFiles: boolean }) {
  const { volumes, intensity, adherence } = data;
  const hasPlanned = volumes.some((v) => v.plannedTotal > 0);
  const showRealized = data.activitiesAvailable && canSeeFiles;
  // Moyenne depuis la première semaine planifiée : les semaines d'avant n'ont simplement pas de données.
  const firstPlanned = Math.max(0, volumes.findIndex((v) => v.plannedTotal > 0));
  const plannedWeeks = volumes.slice(firstPlanned);
  const averagePlanned = plannedWeeks.reduce((sum, v) => sum + v.plannedTotal, 0) / Math.max(1, plannedWeeks.length);
  const totalRealized = volumes.reduce((sum, v) => sum + v.realizedTotal, 0);
  const incomplete = volumes.reduce((sum, v) => sum + v.incomplete, 0);
  const intensityReady = intensity.sessions >= MIN_INTENSITY_SESSIONS && intensity.classified >= MIN_INTENSITY_SECONDS;
  const own = viewer === "athlete";

  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 text-[13.5px] leading-snug text-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Calculé sur les séances publiées, les seuils, les retours de séance et les fichiers FIT importés. Les activités Strava n’entrent dans aucune statistique (règles de Strava) :{" "}
          {own ? "importez le fichier FIT d’une activité, ou donnez votre retour de séance, pour qu’elle soit comptée." : "seuls les fichiers FIT et les retours de l’athlète sont comptés."}
        </span>
      </p>

      <FitnessPanel data={data.fitness} viewer={viewer} />

      <Panel
        title="Volume par semaine"
        description={`Prévu sur les ${VOLUME_WEEKS} dernières semaines, semaine en cours comprise${showRealized ? ", et réalisé d’après les fichiers FIT" : ""}.`}
      >
        {hasPlanned ? (
          <>
            <VolumeChart volumes={volumes} showRealized={showRealized} />
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-3">
              <div>
                <dt className="text-[12px] text-muted">Prévu en moyenne{firstPlanned > 0 ? ` depuis le ${dayMonth(volumes[firstPlanned].week)}` : ""}</dt>
                <dd className="figure text-[18px] text-ink">{formatDurationShort(averagePlanned)} par semaine</dd>
              </div>
              {showRealized ? (
                <div>
                  <dt className="text-[12px] text-muted">Réalisé (fichiers FIT)</dt>
                  <dd className="figure text-[18px] text-ink">{totalRealized ? `${formatDurationShort(totalRealized)} en ${VOLUME_WEEKS} semaines` : "aucun fichier FIT"}</dd>
                </div>
              ) : null}
            </dl>
            {incomplete ? (
              <p className="mt-2 text-[12.5px] text-muted">
                {incomplete} séance{incomplete > 1 ? "s" : ""} sans durée entièrement calculable (étapes libres ou en répétitions, seuils manquants) : le volume affiché les sous-estime.
              </p>
            ) : null}
            {!canSeeFiles ? <p className="mt-2 text-[12.5px] text-muted">L’athlète ne partage pas ses fichiers FIT : le réalisé n’est pas affiché.</p> : null}
            {!data.activitiesAvailable ? <p className="mt-2 text-[12.5px] text-muted">Le réalisé sera disponible après la mise à jour de la base de données du site.</p> : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">Voir le tableau</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[12.5px]">
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Semaine du
                      </th>
                      {STAT_SPORTS.map((sport) => (
                        <th key={sport} scope="col" className="py-1.5 pr-3 font-medium">
                          {SPORT_NAME[sport]}
                        </th>
                      ))}
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Total prévu
                      </th>
                      {showRealized ? (
                        <th scope="col" className="py-1.5 font-medium">
                          Réalisé (FIT)
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="figure divide-y divide-line text-ink">
                    {[...volumes].reverse().map((week) => (
                      <tr key={week.week}>
                        <th scope="row" className="py-1.5 pr-3 font-medium">
                          {dayMonth(week.week)}
                        </th>
                        {STAT_SPORTS.map((sport) => (
                          <td key={sport} className="py-1.5 pr-3">
                            {week.planned[sport] ? formatDurationShort(week.planned[sport]) : "—"}
                          </td>
                        ))}
                        <td className="py-1.5 pr-3 font-semibold">{week.plannedTotal ? formatDurationShort(week.plannedTotal) : "—"}</td>
                        {showRealized ? <td className="py-1.5">{week.realizedTotal ? formatDurationShort(week.realizedTotal) : "—"}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <EmptyState title="Aucune séance publiée sur cette période">Le volume apparaît dès que des séances sont publiées dans le calendrier.</EmptyState>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Intensité prévue" description={`Temps prévu par zone, sur ${INTENSITY_WEEKS} semaines (semaine en cours comprise), en % du seuil.`}>
          {intensityReady ? (
            <>
              <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={INTENSITY_BANDS.map((b) => `${b.label} ${percent((intensity.seconds[b.key] / intensity.classified) * 100)}`).join(", ")}>
                {INTENSITY_BANDS.map((band, i) =>
                  intensity.seconds[band.key] > 0 ? <span key={band.key} className={BAND_FILL[i]} style={{ flexGrow: intensity.seconds[band.key], flexBasis: 0 }} /> : null,
                )}
              </div>
              <table className="mt-3 w-full text-[13px]">
                <tbody className="divide-y divide-line">
                  {INTENSITY_BANDS.map((band, i) => (
                    <tr key={band.key}>
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", BAND_FILL[i])} />Z{i + 1} {band.label} <span className="text-muted">({band.range})</span>
                        </span>
                      </th>
                      <td className="figure py-1.5 text-right text-ink-soft">{intensity.seconds[band.key] ? formatDurationShort(intensity.seconds[band.key]) : "—"}</td>
                      <td className="figure w-14 py-1.5 text-right font-semibold text-ink">{percent((intensity.seconds[band.key] / intensity.classified) * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {intensity.unclassified ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  En plus, {formatDurationShort(intensity.unclassified)} sans intensité exprimable en % du seuil (étapes sans cible, ou seuil manquant), non classées.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-muted">
              Pas assez de données : il faut au moins {MIN_INTENSITY_SESSIONS} séances publiées et 2 h de temps prévu avec une intensité exprimable (% de FTP, de l’allure seuil ou de la FC seuil, zones, RPE) sur la période ;
              actuellement {intensity.sessions} séance{intensity.sessions > 1 ? "s" : ""} et {formatDurationShort(intensity.classified)}.
            </p>
          )}
        </Panel>

        <Panel title="Suivi des séances" description={`Séances publiées des ${ADHERENCE_WEEKS} dernières semaines, jusqu’à hier.`}>
          {adherence === null ? (
            <p className="text-[13.5px] text-muted">Disponible après la mise à jour de la base de données du site.</p>
          ) : adherence.total === 0 ? (
            <p className="text-[13.5px] text-muted">Aucune séance passée sur la période.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(
                  [
                    ["done", "Faites", "retour de l’athlète"],
                    ["partial", "Faites en partie", "retour de l’athlète"],
                    ["skipped", "Pas faites", "retour de l’athlète"],
                    ["fit", "Faites (fichier FIT)", "sans retour"],
                    ["none", "Sans retour", "ni fichier FIT"],
                  ] as const
                ).map(([key, label, hint]) => (
                  <div key={key} className="rounded-[10px] bg-surface-2 px-3 py-2">
                    <dt className="text-[12px] text-ink-soft">{label}</dt>
                    <dd className="figure text-[22px] leading-tight text-ink">{adherence.counts[key]}</dd>
                    <dd className="text-[11.5px] text-muted">{hint}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[12.5px] text-muted">
                Sur {adherence.total} séance{adherence.total > 1 ? "s" : ""} passée{adherence.total > 1 ? "s" : ""}. Une séance confirmée seulement par Strava compte « sans retour ».
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Seuils" description="Évolution des seuils enregistrés dans le profil sportif.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.thresholds.map((series) => (
            <ThresholdTile key={series.key} series={series} today={today} />
          ))}
        </div>
      </Panel>

      <Panel title="Records" description="Tirés des fichiers FIT importés (résumés d’activité).">
        {!showRealized ? (
          <p className="text-[13.5px] text-muted">{!data.activitiesAvailable ? "Disponible après la mise à jour de la base de données du site." : "L’athlète ne partage pas ses fichiers FIT."}</p>
        ) : data.records.length ? (
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
            {(["swim", "bike", "run"] as const).map((sport) => {
              const list = data.records.filter((r) => r.key.startsWith(`${sport}.`));
              return (
                <div key={sport}>
                  <dt className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <span aria-hidden className={cn("size-2.5 rounded-[3px]", SPORT_FILL[sport])} />
                    {SPORT_NAME[sport]}
                  </dt>
                  {list.length ? (
                    list.map((record) => (
                      <dd key={record.key} className="mt-1.5 text-[13px] leading-snug">
                        <span className="block text-muted">{record.label}</span>
                        <span className="figure font-semibold text-ink">{recordValue(record, sport)}</span> <span className="text-muted">· {dayMonthYear(record.date)}</span>
                      </dd>
                    ))
                  ) : (
                    <dd className="mt-1.5 text-[13px] text-muted">Aucun fichier FIT.</dd>
                  )}
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="text-[13.5px] text-muted">{own ? "Aucun fichier FIT importé pour l’instant : importez vos activités depuis le profil sportif." : "Aucun fichier FIT importé par l’athlète."}</p>
        )}
      </Panel>
    </div>
  );
}
