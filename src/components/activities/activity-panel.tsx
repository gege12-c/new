import Link from "next/link";
import { SportGlyph } from "@/components/sport";
import { PanelFrame } from "@/components/planning/panel-frame";
import { activityTitle } from "@/lib/activities/labels";
import { getActivityDetail } from "@/lib/data/activities";
import { formatDayMonth } from "@/lib/planning/dates";
import type { ServerSupabase } from "@/lib/supabase/server";
import { formatTimeOfDay } from "@/lib/workout/format";
import { SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";
import { ActivityFacts } from "./activity-facts";
import { AttachButton, DeleteImportedButton, DetachButton, ProposalButtons } from "./realization-actions";

/** Activité ouverte depuis le calendrier : ses mesures, ses liens aux séances, et de quoi la rattacher. */
export async function ActivityPanel({
  supabase,
  activityId,
  viewer,
  canPlan,
  timeZone,
  closeHref,
  sessionHref,
}: {
  supabase: ServerSupabase;
  activityId: string;
  viewer: "coach" | "athlete";
  canPlan: boolean;
  timeZone: string;
  closeHref: string;
  sessionHref: (sessionId: string) => string;
}) {
  const activity = await getActivityDetail(supabase, activityId);
  if (!activity) {
    return (
      <PanelFrame closeHref={closeHref} title="Activité introuvable">
        <p className="text-[15px] text-muted">
          Cette activité n’existe plus ou ne vous est pas accessible. Les activités Strava sont effacées de TriCoach au bout de 6 jours.
        </p>
      </PanelFrame>
    );
  }
  const canManage = viewer === "athlete" || (canPlan && activity.source !== "strava");
  const attached = activity.links.filter((l) => l.status === "auto" || l.status === "confirmed");
  const proposed = activity.links.filter((l) => l.status === "proposed");
  const linkedIds = new Set(attached.map((l) => l.session_id));
  const candidates = activity.candidates.filter((c) => !linkedIds.has(c.id));
  const title = activityTitle(activity);

  return (
    <PanelFrame closeHref={closeHref} title={title}>
      <div className="space-y-5">
        <h2 className="display pr-10 text-[24px]">{title}</h2>
        <ActivityFacts activity={activity} timeZone={timeZone}>
          {canManage && activity.source === "fit_upload" && viewer === "athlete" ? <DeleteImportedButton activityId={activity.id} onDeletedHref={closeHref} /> : null}
        </ActivityFacts>

        {attached.map((link) => (
          <div key={link.session_id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-success-soft/60 px-3 py-2.5">
            <p className="text-[14px]">
              Rattachée à{" "}
              <Link href={sessionHref(link.session_id)} scroll={false} className="font-semibold underline underline-offset-4">
                {link.title}
              </Link>{" "}
              <span className="text-muted">({formatDayMonth(link.scheduled_date)})</span>
            </p>
            {canManage ? <DetachButton sessionId={link.session_id} activityId={activity.id} /> : null}
          </div>
        ))}

        {proposed.length ? (
          <section aria-labelledby="proposed-title" className="space-y-2 rounded-[12px] border border-warning/30 bg-warning-soft/50 p-3">
            <h3 id="proposed-title" className="text-[14px] font-semibold">
              {proposed.length > 1 ? "Séances possibles" : "Séance possible"}
            </h3>
            {proposed.map((link) => (
              <div key={link.session_id} className="space-y-2 rounded-[10px] bg-surface p-2.5">
                <p className="flex items-center gap-2 text-[14px]">
                  <SportGlyph sport={link.sport as SessionSport} size="sm" />
                  <Link href={sessionHref(link.session_id)} scroll={false} className="font-semibold underline underline-offset-4">
                    {link.title}
                  </Link>
                  <span className="text-muted">({formatDayMonth(link.scheduled_date)})</span>
                </p>
                {canManage ? <ProposalButtons sessionId={link.session_id} activityId={activity.id} /> : null}
              </div>
            ))}
          </section>
        ) : null}

        {canManage ? (
          <section aria-labelledby="attach-title">
            <h3 id="attach-title" className="heading text-[16px]">
              {attached.length ? "Rattacher à une autre séance" : "Rattacher à une séance"}
            </h3>
            {candidates.length ? (
              <ul className="mt-1 divide-y divide-line">
                {candidates.map((session) => (
                  <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                    <SportGlyph sport={session.sport as SessionSport} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{session.title}</span>
                      <span className="figure text-[12.5px] text-muted">
                        {SPORT_LABELS[session.sport as SessionSport] ?? session.sport}, {formatDayMonth(session.scheduled_date)}
                        {session.start_time ? `, ${formatTimeOfDay(session.start_time)}` : ""}
                        {session.state === "draft" ? ", brouillon" : ""}
                      </span>
                    </span>
                    <AttachButton sessionId={session.id} activityId={activity.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[13.5px] text-muted">Aucune séance prévue de la veille au lendemain de cette activité.</p>
            )}
          </section>
        ) : null}
      </div>
    </PanelFrame>
  );
}
