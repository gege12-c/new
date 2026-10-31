import { formatElapsed, formatSpeed } from "@/lib/activities/format";
import type { ActivitySport } from "@/lib/activities/schema";
import { POWER_BEST_DURATIONS, type ActivityLap, type ActivityStreams } from "@/lib/activities/streams";
import { formatDistance, formatDuration } from "@/lib/workout/format";
import { ActivityChart } from "./activity-chart";

const BEST_LABELS: Record<(typeof POWER_BEST_DURATIONS)[number], string> = { 5: "5 s", 60: "1 min", 300: "5 min", 1200: "20 min", 3600: "60 min" };
const KIND_LABELS = { work: "Effort", recovery: "Récupération" } as const;
/** Au-delà, la liste des tours se replie (une sortie avec un tour par kilomètre en compte vite cinquante). */
const OPEN_LAPS = 12;

function LapsTable({ laps, sport, origin }: { laps: ActivityLap[]; sport: ActivitySport; origin: ActivityStreams["laps_origin"] }) {
  const hasPower = laps.some((l) => l.avg_power !== null);
  const hasHr = laps.some((l) => l.avg_hr !== null);
  const hasSpeed = laps.some((l) => l.avg_speed_mps !== null);
  const hasDistance = laps.some((l) => l.distance_m !== null);
  const speedLabel = sport === "run" || sport === "swim" ? "Allure" : "Vitesse";
  const work = laps.filter((l) => l.kind === "work").length;
  const title =
    origin === "detected"
      ? `Intervalles détectés par intervals.icu${work ? ` (${work} effort${work > 1 ? "s" : ""})` : ""}`
      : `Tours enregistrés par la montre (${laps.length})`;
  // Efforts numérotés dans l'ordre : « Effort 1 », « Effort 2 »…
  const names = laps.reduce<{ names: string[]; efforts: number }>(
    (acc, lap, index) => {
      if (lap.kind === "work") acc.efforts += 1;
      acc.names.push(lap.kind === "work" ? `${KIND_LABELS.work} ${acc.efforts}` : lap.kind ? KIND_LABELS[lap.kind] : `Tour ${index + 1}`);
      return acc;
    },
    { names: [], efforts: 0 },
  ).names;
  return (
    <details open={laps.length <= OPEN_LAPS} className="rounded-[12px] border border-line">
      <summary className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold text-ink-soft hover:text-ink">{title}</summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[420px] text-left text-[13px]">
          <thead>
            <tr className="text-[11.5px] text-muted">
              <th scope="col" className="px-3 py-1.5 font-medium">
                <span className="sr-only">Intervalle</span>
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Début</th>
              <th scope="col" className="py-1.5 pr-2 font-medium">Durée</th>
              {hasDistance ? <th scope="col" className="py-1.5 pr-2 font-medium">Distance</th> : null}
              {hasPower ? <th scope="col" className="py-1.5 pr-2 font-medium">Puissance</th> : null}
              {hasHr ? <th scope="col" className="py-1.5 pr-2 font-medium">FC moy.</th> : null}
              {hasSpeed ? <th scope="col" className="py-1.5 pr-3 font-medium">{speedLabel}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {laps.map((lap, index) => {
              const name = names[index];
              const speed = formatSpeed(lap.avg_speed_mps, sport);
              return (
                <tr key={`${lap.start_s}-${index}`} className={lap.kind === "work" ? "font-semibold text-ink" : "text-ink-soft"}>
                  <th scope="row" className="px-3 py-1.5 font-[inherit]">
                    {name}
                    {lap.label ? <span className="block text-[11.5px] font-normal text-muted">{lap.label}</span> : null}
                  </th>
                  <td className="figure py-1.5 pr-2">{formatElapsed(lap.start_s)}</td>
                  <td className="figure py-1.5 pr-2">{formatDuration(lap.duration_s)}</td>
                  {hasDistance ? <td className="figure py-1.5 pr-2">{lap.distance_m !== null ? formatDistance(lap.distance_m, sport === "swim" ? "swim" : undefined) : "—"}</td> : null}
                  {hasPower ? <td className="figure py-1.5 pr-2">{lap.avg_power !== null ? `${lap.avg_power} W` : "—"}</td> : null}
                  {hasHr ? <td className="figure py-1.5 pr-2">{lap.avg_hr !== null ? `${lap.avg_hr} bpm` : "—"}</td> : null}
                  {hasSpeed ? <td className="figure py-1.5 pr-3">{speed?.value ?? "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Analyse d'une activité : courbes, meilleures puissances, intervalles ou tours. */
export function ActivityAnalysis({ streams, sport }: { streams: ActivityStreams; sport: ActivitySport }) {
  const bests = POWER_BEST_DURATIONS.filter((d) => streams.bests[`${d}`]);
  return (
    <section aria-label="Courbes et intervalles" className="space-y-3">
      <ActivityChart series={streams.series} sport={sport} laps={streams.laps} />
      {bests.length ? (
        <div className="rounded-[12px] bg-surface-2 px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-ink-soft">Meilleures puissances de la séance</p>
          <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 sm:grid-cols-5">
            {bests.map((d) => (
              <div key={d}>
                <dt className="text-[11.5px] text-muted">{BEST_LABELS[d]}</dt>
                <dd className="figure text-[15px] font-semibold text-ink">{streams.bests[`${d}`]} W</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {streams.laps.length ? <LapsTable laps={streams.laps} sport={sport} origin={streams.laps_origin} /> : null}
    </section>
  );
}
