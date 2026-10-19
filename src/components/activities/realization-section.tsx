import { Upload } from "lucide-react";
import { SPORT_ICONS, SPORT_STYLES } from "@/components/sport";
import { TextLink } from "@/components/ui/button";
import { activityDuration, completionRatio, DONE_RATIO, deviation, realizedTotals } from "@/lib/activities/compare";
import { formatSignedDistance, formatSignedDuration, formatSignedPercent } from "@/lib/activities/format";
import { activityTitle } from "@/lib/activities/labels";
import type { SessionRealizationDetail } from "@/lib/data/activities";
import type { CalendarActivity, CalendarSession } from "@/lib/data/planning-types";
import { formatDayMonth } from "@/lib/planning/dates";
import { STATUS_LABELS, type SessionStatus } from "@/lib/planning/status";
import { formatDistance, formatDurationShort, formatTimeOfDay } from "@/lib/workout/format";
import { cn } from "@/lib/utils";
import { ActivityFacts } from "./activity-facts";
import { AttachButton, CompletionForm, DetachButton, ProposalButtons } from "./realization-actions";

type SessionLike = Pick<CalendarSession, "id" | "sport" | "state" | "scheduled_date" | "planned_duration_s" | "planned_distance_m">;

const COMPLETION_TEXT = { done: "Faite", partial: "Faite en partie", skipped: "Pas faite" } as const;

const stamp = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

/** Prévu contre réalisé : part du prévu, puis durée et distance avec leurs écarts. */
function Comparison({ session, activities }: { session: SessionLike; activities: CalendarActivity[] }) {
  const totals = realizedTotals(activities);
  const ratio = completionRatio(session, totals);
  const swim = session.sport === "swim" ? "swim" : undefined;
  const rows = [
    {
      label: "Durée",
      planned: session.planned_duration_s ? formatDurationShort(session.planned_duration_s) : null,
      actual: totals.durationS !== null ? formatDurationShort(totals.durationS) : null,
      gap: deviation(session.planned_duration_s, totals.durationS),
      signed: formatSignedDuration,
    },
    {
      label: "Distance",
      planned: session.planned_distance_m ? formatDistance(session.planned_distance_m, swim) : null,
      actual: totals.distanceM !== null ? formatDistance(totals.distanceM, swim) : null,
      gap: deviation(session.planned_distance_m, totals.distanceM),
      signed: (delta: number) => formatSignedDistance(delta, session.sport === "swim" ? "swim" : undefined),
    },
  ].filter((row) => row.planned || row.actual);
  const reach = ratio === null ? null : Math.max(1, ratio);

  return (
    <div className="rounded-[12px] bg-surface-2 p-3">
      {ratio !== null && reach !== null ? (
        <div className="mb-3">
          <p className="flex items-baseline justify-between gap-2 text-[13.5px] text-ink-soft">
            <span>
              Réalisé à <span className="figure text-[17px] font-semibold text-ink">{Math.round(ratio * 100)}&nbsp;%</span> du prévu
            </span>
            <span className={cn("text-[12.5px] font-semibold", ratio >= DONE_RATIO ? "text-success" : "text-warning")}>
              {ratio >= DONE_RATIO ? STATUS_LABELS.done : STATUS_LABELS.partial}
            </span>
          </p>
          <div className="relative mt-2 h-2 rounded-full bg-surface-3" aria-hidden>
            <span
              className={cn("absolute inset-y-0 left-0 rounded-full", ratio >= DONE_RATIO ? "bg-success" : "bg-warning")}
              style={{ width: `${(Math.min(ratio, reach) / reach) * 100}%` }}
            />
            <span className="absolute -inset-y-1 w-[2px] rounded-full bg-ink" style={{ left: `calc(${(1 / reach) * 100}% - 1px)` }} title="Prévu" />
          </div>
        </div>
      ) : (
        <p className="mb-2 text-[13px] text-muted">Ni durée ni distance prévues : la part réalisée ne peut pas être calculée.</p>
      )}
      {rows.length ? (
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="text-[11.5px] text-muted">
              <th scope="col" className="pb-1 font-medium">
                <span className="sr-only">Mesure</span>
              </th>
              <th scope="col" className="pb-1 font-medium">Prévu</th>
              <th scope="col" className="pb-1 font-medium">Réalisé</th>
              <th scope="col" className="pb-1 text-right font-medium">Écart</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-1.5 pr-2 font-medium text-ink-soft">
                  {row.label}
                </th>
                <td className="figure py-1.5 pr-2">{row.planned ?? <span className="text-muted">non prévue</span>}</td>
                <td className="figure py-1.5 pr-2">{row.actual ?? <span className="text-muted">non mesurée</span>}</td>
                <td className="figure py-1.5 text-right">
                  {row.gap ? (
                    <>
                      {row.signed(row.gap.delta)} <span className="text-muted">({formatSignedPercent(row.gap.percent)})</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function CandidateRow({ sessionId, activity }: { sessionId: string; activity: CalendarActivity & { attachedElsewhere: boolean } }) {
  const Icon = SPORT_ICONS[activity.sport];
  const duration = activityDuration(activity);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", SPORT_STYLES[activity.sport].soft, SPORT_STYLES[activity.sport].ink)}>
        <Icon className="size-3.5" strokeWidth={2.4} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{activityTitle(activity)}</span>
        <span className="figure text-[12.5px] text-muted">
          {formatDayMonth(activity.local_date)}
          {activity.local_start_time ? `, ${formatTimeOfDay(activity.local_start_time)}` : ""}
          {duration ? `, ${formatDurationShort(duration)}` : ""}
          {activity.source === "strava" ? ", Strava" : ", fichier FIT"}
          {activity.attachedElsewhere ? ", rattachée à une autre séance" : ""}
        </span>
      </span>
      <AttachButton sessionId={sessionId} activityId={activity.id} label={activity.attachedElsewhere ? "Rattacher ici" : "Rattacher"} />
    </li>
  );
}

/**
 * Section « Prévu et réalisé » du panneau de séance. L’athlète y voit ses activités (Strava compris),
 * valide les propositions et donne son retour ; le coach voit les fichiers importés et ce retour.
 */
export function RealizationSection({
  session,
  realization,
  status,
  viewer,
  canPlan,
  stravaShared = false,
  today,
  timeZone,
}: {
  session: SessionLike;
  realization: SessionRealizationDetail;
  status: SessionStatus;
  viewer: "coach" | "athlete";
  canPlan: boolean;
  /** Coach : l’athlète l’autorise à voir ses activités Strava. Athlète : au moins un coach autorisé. */
  stravaShared?: boolean;
  today: string;
  timeZone: string;
}) {
  const { attached, proposals, candidates, completion } = realization;
  const canManage = (activity: CalendarActivity) => viewer === "athlete" || (canPlan && activity.source !== "strava");
  const past = session.scheduled_date <= today;
  const nothing = !attached.length && !proposals.length;
  const attachable = candidates.filter(canManage);

  // Séance à venir sans rien de réalisé ni à rattacher : rien à comparer pour l’instant.
  if (!past && nothing && !attachable.length && session.state !== "draft") return null;

  if (session.state === "draft") {
    return (
      <section aria-labelledby="done-title">
        <h3 id="done-title" className="heading text-[16px]">
          Prévu et réalisé
        </h3>
        <p className="mt-1.5 text-[13.5px] text-muted">Brouillon : le réalisé s’affichera une fois la séance publiée.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="done-title" className="space-y-3">
      <h3 id="done-title" className="heading text-[16px]">
        Prévu et réalisé
      </h3>

      {attached.length ? <Comparison session={session} activities={attached} /> : null}
      {attached.map((activity) => (
        <ActivityFacts key={activity.id} activity={activity} timeZone={timeZone}>
          {canManage(activity) ? <DetachButton sessionId={session.id} activityId={activity.id} /> : null}
          {activity.match.status === "auto" ? <span className="self-center text-[12px] text-muted">Rattachée automatiquement</span> : null}
        </ActivityFacts>
      ))}

      {proposals.length ? (
        <div className="space-y-2 rounded-[12px] border border-warning/30 bg-warning-soft/50 p-3">
          <p className="text-[14px] font-semibold text-ink">{proposals.length > 1 ? "Laquelle de ces activités correspond à la séance ?" : "Cette activité correspond-elle à la séance ?"}</p>
          <p className="text-[13px] text-ink-soft">Le rapprochement automatique hésite : votre réponse est définitive pour cette paire.</p>
          {proposals.map((activity) => (
            <ActivityFacts key={activity.id} activity={activity} timeZone={timeZone}>
              {canManage(activity) ? <ProposalButtons sessionId={session.id} activityId={activity.id} /> : <span className="text-[12.5px] text-muted">L’athlète doit confirmer.</span>}
            </ActivityFacts>
          ))}
        </div>
      ) : null}

      {nothing ? (
        session.state === "cancelled" ? (
          <p className="text-[13.5px] text-muted">Séance annulée.</p>
        ) : attachable.length ? (
          <div>
            <p className="text-[13.5px] text-ink-soft">Aucune activité rattachée. Activités de la veille au lendemain :</p>
            <ul className="divide-y divide-line">
              {attachable.map((activity) => (
                <CandidateRow key={activity.id} sessionId={session.id} activity={activity} />
              ))}
            </ul>
          </div>
        ) : viewer === "athlete" ? (
          <div className="rounded-[12px] border border-dashed border-line-strong p-3 text-[13.5px] text-ink-soft">
            Aucune activité trouvée de la veille au lendemain.{" "}
            <TextLink href="/athlete/profile#connexions" className="inline-flex items-center gap-1">
              <Upload className="size-3.5" aria-hidden />
              Connecter Strava ou importer un fichier FIT
            </TextLink>
          </div>
        ) : (
          <p className="text-[13.5px] text-muted">Aucune activité importée rattachée à cette séance.</p>
        )
      ) : attachable.length ? (
        <details className="rounded-[12px] border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold text-ink-soft hover:text-ink">Rattacher une autre activité</summary>
          <ul className="divide-y divide-line border-t border-line px-3">
            {attachable.map((activity) => (
              <CandidateRow key={activity.id} sessionId={session.id} activity={activity} />
            ))}
          </ul>
        </details>
      ) : null}

      {viewer === "coach" ? (
        <p className="text-[12.5px] leading-snug text-muted">
          {stravaShared
            ? "L’athlète vous autorise à voir ses activités Strava : gardées 6 jours dans TriCoach, elles n’entrent dans aucune statistique (règles de Strava). Vous voyez aussi ses fichiers FIT importés, s’il vous y autorise, et son retour ci-dessous."
            : "Les activités Strava de l’athlète ne vous sont montrées que s’il vous y autorise, depuis son profil sportif (règles de Strava). Vous voyez ses fichiers FIT importés, s’il vous y autorise, et son retour ci-dessous."}
        </p>
      ) : null}

      {viewer === "athlete" && session.state === "published" && past ? (
        <div className="rounded-[12px] border border-line p-3">
          <h4 className="text-[14px] font-semibold">Votre retour</h4>
          <p className="mb-3 mt-0.5 text-[12.5px] text-muted">
            Visible par votre coach.
            {status === "done" || status === "partial"
              ? stravaShared
                ? " Vos activités Strava sont partagées avec le coach que vous avez autorisé."
                : " Il ne voit pas vos activités Strava, sauf si vous l’y autorisez (profil sportif, « Mon coach »)."
              : ""}
          </p>
          <CompletionForm key={session.id} sessionId={session.id} completion={completion} />
        </div>
      ) : null}

      {viewer === "coach" && session.state !== "cancelled" ? (
        completion ? (
          <div className="rounded-[12px] border border-line p-3">
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[14px] font-semibold">
                Retour de l’athlète : {COMPLETION_TEXT[completion.status]}
                {completion.rpe ? <span className="figure">, RPE {completion.rpe}/10</span> : null}
              </span>
              <span className="text-[12px] text-muted">{stamp(completion.updated_at, timeZone)}</span>
            </p>
            {completion.note ? <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">{completion.note}</p> : null}
          </div>
        ) : past ? (
          <p className="text-[13.5px] text-muted">Pas encore de retour de l’athlète sur cette séance.</p>
        ) : null
      ) : null}
    </section>
  );
}
