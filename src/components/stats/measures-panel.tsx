import { Panel } from "@/components/ui/panel";
import { MEASURE_DAYS, measureTrend, type MeasureTrend } from "@/lib/wellness/trends";
import { formatMeasure, MEASURE_DEFS, MEASURES, type MeasureKey, type WellnessEntry } from "@/lib/wellness/wellness";
import { cn } from "@/lib/utils";

const W = 300;
const H = 64;
const MIN_POINTS = 3;
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** Lecture de la moyenne récente : ce qu'elle dit, sans jugement médical. */
const STATUS_TEXT: Record<MeasureKey, Record<"below" | "within" | "above", { text: string; tone: "warning" | "muted" | "success" }>> = {
  hrv_ms: {
    below: { text: "en dessous de votre zone habituelle : la récupération est peut-être incomplète", tone: "warning" },
    within: { text: "dans votre zone habituelle", tone: "muted" },
    above: { text: "au-dessus de votre zone habituelle", tone: "success" },
  },
  resting_hr: {
    below: { text: "en dessous de votre zone habituelle", tone: "muted" },
    within: { text: "dans votre zone habituelle", tone: "muted" },
    above: { text: "au-dessus de votre zone habituelle : fatigue, chaleur ou maladie possibles", tone: "warning" },
  },
  sleep_hours: {
    below: { text: "moins que d’habitude", tone: "warning" },
    within: { text: "comme d’habitude", tone: "muted" },
    above: { text: "plus que d’habitude", tone: "success" },
  },
  weight_kg: {
    below: { text: "en dessous de votre poids habituel", tone: "muted" },
    within: { text: "stable", tone: "muted" },
    above: { text: "au-dessus de votre poids habituel", tone: "muted" },
  },
};

function TrendChart({ trend, label }: { trend: MeasureTrend; label: string }) {
  const known = trend.values.filter((v): v is number => v !== null);
  const lows = [...known, ...(trend.band ? [trend.band.low] : [])];
  const highs = [...known, ...(trend.band ? [trend.band.high] : [])];
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, trend.days.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  // Un trait par suite de jours renseignés : un jour vide coupe la courbe (rien n'est interpolé).
  const runs: string[] = [];
  let current = "";
  trend.values.forEach((v, i) => {
    if (v === null) {
      if (current) runs.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) runs.push(current);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-16 w-full overflow-visible">
      {trend.band ? <rect x={0} y={y(trend.band.high)} width={W} height={Math.max(1, y(trend.band.low) - y(trend.band.high))} fill="var(--surface-3)" /> : null}
      {runs.map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--chart-swim)" strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function MeasureCard({ trend }: { trend: MeasureTrend }) {
  const def = MEASURE_DEFS[trend.key];
  const known = trend.values.filter((v): v is number => v !== null);
  const status = trend.status ? STATUS_TEXT[trend.key][trend.status] : null;
  return (
    <div className="min-w-0 rounded-[12px] border border-line p-3" data-measure={trend.key}>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-soft">{def.label}</span>
        <span className="figure text-[17px] text-ink">{trend.last === null ? "—" : formatMeasure(trend.key, trend.last)}</span>
      </p>
      {known.length >= MIN_POINTS ? (
        <>
          <TrendChart
            trend={trend}
            label={`${def.label} sur ${MEASURE_DAYS} jours : de ${formatMeasure(trend.key, Math.min(...known))} à ${formatMeasure(trend.key, Math.max(...known))}${
              trend.band ? `, zone habituelle ${formatMeasure(trend.key, trend.band.low)} à ${formatMeasure(trend.key, trend.band.high)}` : ""
            }`}
          />
          <p className="text-[12.5px] leading-snug text-ink-soft">
            {trend.recent !== null ? (
              <>
                7 derniers jours : <span className="figure font-semibold text-ink">{formatMeasure(trend.key, trend.recent)}</span>
                {status ? <span className={cn(status.tone === "warning" ? "text-warning" : status.tone === "success" ? "text-success" : "text-muted")}>, {status.text}</span> : null}
              </>
            ) : (
              <span className="text-muted">{known.length} jours renseignés sur {MEASURE_DAYS}</span>
            )}
          </p>
          <p className="text-[12px] text-muted">
            {trend.band
              ? `Zone habituelle (bande grise) : ${formatMeasure(trend.key, trend.band.low)} à ${formatMeasure(trend.key, trend.band.high)}, d’après les 60 jours d’avant.`
              : "La zone habituelle apparaît avec deux semaines de mesures sur les deux mois d’avant."}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[12px] text-muted">{known.length ? `${known.length} jour${known.length > 1 ? "s" : ""} : la courbe apparaît à partir de 3.` : "Pas encore de mesure."}</p>
      )}
    </div>
  );
}

/**
 * Mesures du matin sur 90 jours : celles de la montre (reçues par intervals.icu) ou saisies dans la
 * forme du jour, avec la moyenne des 7 derniers jours et la zone habituelle de l'athlète.
 */
export function MeasuresPanel({ entries, today, viewer }: { entries: WellnessEntry[] | null; today: string; viewer: "athlete" | "coach" }) {
  if (entries === null) return null;
  const trends = MEASURES.map((key) => measureTrend(entries, key, today));
  const any = trends.some((t) => t.known > 0);
  return (
    <Panel
      id="mesures"
      title="Mesures du matin"
      description={`VFC, FC au repos, sommeil et poids sur ${MEASURE_DAYS} jours, de la montre (par intervals.icu) ou de la forme du jour.`}
    >
      {any ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {trends
            .filter((t) => t.known > 0)
            .map((trend) => (
              <MeasureCard key={trend.key} trend={trend} />
            ))}
        </div>
      ) : (
        <p className="text-[13.5px] text-muted">
          {viewer === "athlete"
            ? "Aucune mesure pour l’instant : reliez votre montre par intervals.icu (profil sportif), ou saisissez-les dans la forme du jour, sur l’accueil."
            : "Aucune mesure de l’athlète pour l’instant."}
        </p>
      )}
      <p className="mt-3 text-[12px] text-muted">
        Du {shortDate(trends[0].days[0])} au {shortDate(today)}. Une mesure isolée varie beaucoup : c’est la tendance qui compte.
      </p>
    </Panel>
  );
}
