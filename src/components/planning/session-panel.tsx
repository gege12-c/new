import { History, MessageSquareText, Soup } from "lucide-react";
import { RealizationSection } from "@/components/activities/realization-section";
import { ExportSection } from "@/components/exports/export-section";
import { SportBadge } from "@/components/sport";
import { relativeProfileNote, WorkoutProfile } from "@/components/workout/workout-profile";
import { getSessionRealization } from "@/lib/data/activities";
import { sharesStravaWithCoach } from "@/lib/data/athlete";
import { getExportHistory } from "@/lib/data/exports";
import { getSessionComments, getSessionDetail, getSessionHistory, getThresholdsOn } from "@/lib/data/planning";
import { compatibilityReports } from "@/lib/export/connectors";
import { exportContext } from "@/lib/export/session";
import { workoutSheet } from "@/lib/export/sheet";
import type { HistoryEntry } from "@/lib/data/planning-types";
import { formatFullDate } from "@/lib/planning/dates";
import { FIELD_LABELS, type EditableField } from "@/lib/planning/snapshot";
import { sessionStatus, STATUS_HINTS, STATUS_LABELS } from "@/lib/planning/status";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { computeTotals } from "@/lib/workout/compute";
import { formatDistance, formatDuration } from "@/lib/workout/format";
import { OBJECTIVE_LABELS, parseWorkout, type SessionObjective } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";
import { CommentsThread } from "./comments";
import { PanelActions } from "./panel-actions";
import { PanelFrame } from "./panel-frame";
import { Prescription } from "./prescription";

const STATUS_TONE: Record<string, string> = {
  draft: "border border-dashed border-line-strong text-ink-soft",
  planned: "bg-surface-3 text-ink",
  done: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
  missed: "bg-danger-soft text-danger",
  unreconciled: "bg-surface-3 text-ink-soft",
  cancelled: "bg-surface-3 text-muted line-through",
};

const historyTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

function describeEntry(entry: HistoryEntry): string {
  if (entry.action === "insert") return "a créé la séance";
  if (entry.action === "delete") return "a supprimé la séance";
  const changes = entry.changes as Record<string, unknown>;
  if ("state" in changes && Array.isArray(changes.state)) {
    const [, to] = changes.state as [string, string];
    if (to === "published") return "a publié la séance";
    if (to === "draft") return "a repassé la séance en brouillon";
    if (to === "cancelled") return "a annulé la séance";
  }
  if ("scheduled_date" in changes && Array.isArray(changes.scheduled_date) && entry.fields.length <= 2) {
    const [, to] = changes.scheduled_date as [string, string];
    return `a déplacé la séance au ${formatFullDate(to)}`;
  }
  const labels = entry.fields
    .filter((f): f is EditableField => f in FIELD_LABELS)
    .filter((f) => f !== "planned_duration_s" && f !== "planned_distance_m")
    .map((f) => FIELD_LABELS[f]);
  return labels.length ? `a modifié : ${labels.join(", ")}` : "a modifié la séance";
}

/** Détail d’une séance par-dessus le calendrier. Lecture via l’API, sous les droits de l’utilisateur. */
export async function SessionPanel({
  supabase,
  sessionId,
  viewerId,
  viewer,
  today,
  timeZone,
  thresholds,
  closeHref,
  editHref,
  canPlan,
  stravaShared,
}: {
  supabase: ServerSupabase;
  sessionId: string;
  viewerId: string;
  viewer: "coach" | "athlete";
  today: string;
  timeZone: string;
  thresholds?: AthleteThresholds;
  closeHref: string;
  editHref: string | null;
  canPlan: boolean;
  /** Coach : l’athlète l’autorise à voir ses activités Strava. Athlète : lu ici (au moins un coach autorisé). */
  stravaShared?: boolean;
}) {
  const detail = await getSessionDetail(supabase, sessionId, { withDraft: viewer === "coach" || undefined });
  if (!detail) {
    return (
      <PanelFrame closeHref={closeHref} title="Séance introuvable">
        <p className="text-[15px] text-muted">Cette séance n’existe plus ou ne vous est plus accessible.</p>
      </PanelFrame>
    );
  }
  const exportable = detail.state !== "cancelled";
  const [comments, history, realization, exportHistory, thresholdsOnDate, shared] = await Promise.all([
    getSessionComments(supabase, sessionId),
    getSessionHistory(supabase, sessionId),
    getSessionRealization(supabase, detail),
    exportable ? getExportHistory(supabase, sessionId) : Promise.resolve(null),
    // Les exports utilisent les seuils en vigueur à la date de la séance (comme le téléchargement).
    exportable ? getThresholdsOn(supabase, detail.athlete_id, detail.scheduled_date) : Promise.resolve(undefined),
    viewer === "athlete" ? sharesStravaWithCoach(supabase, viewerId) : Promise.resolve(stravaShared === true),
  ]);
  const exportCtx = exportContext(detail, thresholdsOnDate);
  // Contenu normalisé (valeurs par défaut du format) : c'est lui que le téléchargement convertit.
  const parsedContent = exportable ? parseWorkout(detail.content) : null;
  const status = sessionStatus({ ...detail, realization: realization ?? undefined }, today);
  const totals = computeTotals(detail.content, thresholds);
  // Sous le profil, seulement quand des hauteurs sont comparées faute de seuil (le pointillé se passe de légende).
  const relativeProfile = relativeProfileNote(detail.content, thresholds);
  const ownSession = detail.created_by === viewerId;
  const canMove = canPlan || (viewer === "athlete" && detail.state !== "cancelled");
  const time = detail.start_time ? detail.start_time.slice(0, 5).replace(":", " h ") : null;

  return (
    <PanelFrame closeHref={closeHref} title={detail.title}>
      <div className="space-y-6">
        <header>
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <SportBadge sport={detail.sport} />
            <span className={cn("rounded-[6px] px-2 py-[3px] text-[12px] font-semibold", STATUS_TONE[status])} title={STATUS_HINTS[status]}>
              {STATUS_LABELS[status]}
            </span>
            {detail.pending ? <span className="rounded-[6px] bg-warning-soft px-2 py-[3px] text-[12px] font-semibold text-warning">Modifications non publiées</span> : null}
          </div>
          <h2 className="display mt-3 text-[26px]">{detail.title}</h2>
          <p className="mt-1 text-[14px] text-ink-soft first-letter:uppercase">
            {formatFullDate(detail.scheduled_date)}
            {time ? <span className="normal-case">, {time}</span> : null}
          </p>
          {detail.objective ? (
            <p className="mt-1 text-[14px] text-muted">Objectif : {OBJECTIVE_LABELS[detail.objective as SessionObjective] ?? detail.objective}</p>
          ) : null}
        </header>

        <div className="rounded-[14px] bg-night p-4 text-night-ink">
          <WorkoutProfile workout={detail.content} thresholds={thresholds} height={84} thresholdLine className="text-night-ink" />
          {relativeProfile ? <p className="mt-1.5 text-[11px] text-night-muted">{relativeProfile}</p> : null}
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-[11px] font-semibold text-night-muted">Durée</dt>
              <dd className="figure text-[24px] leading-tight">
                {totals.duration.value ? formatDuration(totals.duration.value) : "—"}
                {totals.duration.status === "estimated" || totals.duration.status === "partial" ? <span className="ml-1 text-[12px] text-night-muted">estimée</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-night-muted">Distance</dt>
              <dd className="figure text-[24px] leading-tight">
                {totals.distance.value ? formatDistance(totals.distance.value, detail.sport === "swim" ? "swim" : undefined) : "—"}
                {totals.distance.status === "estimated" || totals.distance.status === "partial" ? <span className="ml-1 text-[12px] text-night-muted">estimée</span> : null}
              </dd>
            </div>
          </dl>
        </div>

        <PanelActions
          sessionId={detail.id}
          date={detail.scheduled_date}
          state={detail.state}
          pending={detail.pending}
          editHref={editHref && (canPlan || ownSession) ? editHref : null}
          closeHref={closeHref}
          canPlan={canPlan}
          canMove={canMove}
        />

        <section aria-labelledby="prescription-title">
          <h3 id="prescription-title" className="heading text-[16px]">
            Prescription
          </h3>
          <div className="mt-2">
            <Prescription workout={detail.content} thresholds={thresholds} />
          </div>
        </section>

        {detail.description ? (
          <section aria-labelledby="notes-title">
            <h3 id="notes-title" className="heading text-[16px]">
              Consignes
            </h3>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">{detail.description}</p>
          </section>
        ) : null}

        {detail.nutrition_notes ? (
          <section aria-labelledby="nutrition-title" className="rounded-[12px] bg-surface-2 p-3">
            <h3 id="nutrition-title" className="flex items-center gap-2 text-[14px] font-semibold">
              <Soup className="size-4 text-muted" aria-hidden />
              Nutrition et hydratation
            </h3>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">{detail.nutrition_notes}</p>
          </section>
        ) : null}

        {parsedContent?.success ? (
          <ExportSection
            sessionId={detail.id}
            version={detail.version}
            reports={compatibilityReports(parsedContent.data.segments, exportCtx)}
            history={exportHistory}
            sheet={workoutSheet(parsedContent.data, { title: detail.title, thresholds: thresholdsOnDate, description: detail.description })}
            multiSegment={parsedContent.data.segments.length > 1}
            timeZone={timeZone}
          />
        ) : parsedContent ? (
          <section aria-labelledby="export-title">
            <h3 id="export-title" className="heading text-[16px]">
              Exporter vers mes appareils
            </h3>
            <p className="mt-1.5 text-[13.5px] text-muted">Le contenu de cette séance est invalide : ouvrez-la dans l’éditeur pour la corriger avant de l’exporter.</p>
          </section>
        ) : null}

        {realization ? (
          <RealizationSection
            session={detail}
            realization={realization}
            status={status}
            viewer={viewer}
            canPlan={canPlan}
            stravaShared={shared}
            today={today}
            timeZone={timeZone}
          />
        ) : (
          <section aria-labelledby="done-title">
            <h3 id="done-title" className="heading text-[16px]">
              Prévu et réalisé
            </h3>
            <p className="mt-1.5 text-[13.5px] text-muted">{SCHEMA_PENDING_MESSAGE}</p>
          </section>
        )}

        <section aria-labelledby="comments-title">
          <h3 id="comments-title" className="heading mb-3 flex items-center gap-2 text-[16px]">
            <MessageSquareText className="size-[18px] text-muted" aria-hidden />
            Commentaires
          </h3>
          <CommentsThread sessionId={detail.id} comments={comments} currentUserId={viewerId} canWritePrivate={viewer === "coach"} timeZone={timeZone} />
        </section>

        {history.length ? (
          <details className="group rounded-[12px] border border-line">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[14px] font-semibold text-ink-soft hover:text-ink">
              <History className="size-4 text-muted" aria-hidden />
              Historique des modifications
              <span className="figure ml-auto text-[12px] text-muted">{history.length}</span>
            </summary>
            <ol className="space-y-2 border-t border-line px-3 py-3">
              {history.map((entry) => (
                <li key={entry.id} className="text-[13px] leading-snug">
                  <span className="font-semibold text-ink">{entry.actor_name}</span> <span className="text-ink-soft">{describeEntry(entry)}</span>
                  <span className="block text-[12px] text-muted">{historyTime(entry.occurred_at, timeZone)}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </PanelFrame>
  );
}
