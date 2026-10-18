import { ExternalLink } from "lucide-react";
import { SPORT_ICONS, SPORT_STYLES } from "@/components/sport";
import { activityDuration } from "@/lib/activities/compare";
import { formatSpeed } from "@/lib/activities/format";
import { activityTitle } from "@/lib/activities/labels";
import type { CalendarActivity } from "@/lib/data/planning-types";
import { formatFullDate } from "@/lib/planning/dates";
import { formatDistance, formatDurationShort, formatTimeOfDay } from "@/lib/workout/format";
import { cn } from "@/lib/utils";

const dayFormat = (iso: string, timeZone: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone }).format(new Date(iso));

/** Lien vers l’activité sur Strava, selon les règles de marque de Strava (texte « View on Strava », gras et souligné). */
export function ViewOnStrava({ externalId, className }: { externalId: string; className?: string }) {
  return (
    <a
      href={`https://www.strava.com/activities/${encodeURIComponent(externalId)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 text-[13px] font-bold text-ink underline underline-offset-4 hover:decoration-2", className)}
    >
      View on Strava
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(nouvel onglet)</span>
    </a>
  );
}

export function SourceBadge({ activity }: { activity: Pick<CalendarActivity, "source"> }) {
  return (
    <span className="rounded-[6px] bg-surface-3 px-1.5 py-[2px] text-[11.5px] font-semibold text-ink-soft">
      {activity.source === "strava" ? "Strava" : "Fichier FIT"}
    </span>
  );
}

/** Une activité réalisée : discipline, source, heure et mesures disponibles (rien n’est estimé). */
export function ActivityFacts({ activity, timeZone, children }: { activity: CalendarActivity; timeZone: string; children?: React.ReactNode }) {
  const Icon = SPORT_ICONS[activity.sport];
  const duration = activityDuration(activity);
  const speed = formatSpeed(activity.avg_speed_mps, activity.sport);
  const facts: { label: string; value: string }[] = [
    { label: activity.sport === "strength" || activity.sport === "other" ? "Durée" : "Durée en mouvement", value: duration ? formatDurationShort(duration) : "non mesurée" },
    { label: "Distance", value: activity.distance_m ? formatDistance(activity.distance_m, activity.sport === "swim" ? "swim" : undefined) : "non mesurée" },
  ];
  if (speed) facts.push(speed);
  if (activity.elevation_gain_m && (activity.sport === "bike" || activity.sport === "run")) facts.push({ label: "Dénivelé positif", value: `${Math.round(activity.elevation_gain_m)} m` });
  if (activity.avg_hr) facts.push({ label: "FC moyenne", value: `${activity.avg_hr} bpm` });
  if (activity.max_hr) facts.push({ label: "FC max", value: `${activity.max_hr} bpm` });
  if (activity.avg_power) facts.push({ label: "Puissance moyenne", value: `${activity.avg_power} W` });
  if (activity.weighted_power) facts.push({ label: "Puissance pondérée", value: `${activity.weighted_power} W` });
  const details = [activity.trainer ? (activity.sport === "run" ? "Tapis" : "Home-trainer") : null, activity.device_name].filter(Boolean).join(", ");

  return (
    <article className="rounded-[12px] border border-line bg-surface p-3">
      <header className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", SPORT_STYLES[activity.sport].soft, SPORT_STYLES[activity.sport].ink)}>
          <Icon className="size-4" strokeWidth={2.3} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-semibold leading-snug">{activityTitle(activity)}</span>
            <SourceBadge activity={activity} />
          </p>
          <p className="mt-0.5 text-[13px] text-muted first-letter:uppercase">
            {formatFullDate(activity.local_date)}
            {activity.local_start_time ? `, ${formatTimeOfDay(activity.local_start_time.slice(0, 5))}` : ""}
          </p>
        </div>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-[11.5px] font-medium text-muted">{fact.label}</dt>
            <dd className={cn("figure text-[15px]", fact.value.startsWith("non ") && "text-[13px] text-muted")}>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {details ? <p className="mt-2 text-[12px] text-muted">{details}</p> : null}
      {activity.source === "strava" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <ViewOnStrava externalId={activity.external_id} />
          {activity.expires_at ? (
            <span className="text-[12px] text-muted" title="Les données Strava ne peuvent pas être conservées plus de 7 jours.">
              Effacée de TriCoach le {dayFormat(activity.expires_at, timeZone)}
            </span>
          ) : null}
        </div>
      ) : null}
      {children ? <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">{children}</div> : null}
    </article>
  );
}
