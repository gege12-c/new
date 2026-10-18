import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { revokeCoachLink } from "@/app/(app)/actions";
import { CoachPermissionsForm } from "@/components/athlete/coach-permissions-form";
import { PriorityBadge, SportDot } from "@/components/sport";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState, Notice, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getEvents, getMyCoaches, getThresholds, getUpcomingSessions } from "@/lib/data/athlete";
import { THRESHOLD_DEFS, currentThresholds, formatThresholdValue } from "@/lib/thresholds";
import { daysBetween, formatLocalDate, localDate } from "@/lib/utils";
import { formatDistance, formatDuration } from "@/lib/workout/format";
import { OBJECTIVE_LABELS, type SessionObjective, type SessionSport } from "@/lib/workout/schema";

export const metadata: Metadata = { title: "Mon entraînement" };

export default function AthleteHomePage({ searchParams }: PageProps<"/athlete">) {
  return (
    <>
      <PageHeader title="Mon entraînement" description="Vos prochaines séances, votre objectif et votre coach." />
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteHome searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AthleteHome({ searchParams }: Pick<PageProps<"/athlete">, "searchParams">) {
  const [{ supabase, userId }, profile, params] = await Promise.all([requireSession("/athlete"), getProfile(), searchParams]);
  const today = localDate(profile.timezone);
  const [sessions, events, coaches, thresholds] = await Promise.all([
    getUpcomingSessions(supabase, userId, today),
    getEvents(supabase, userId),
    getMyCoaches(supabase, userId),
    getThresholds(supabase, userId),
  ]);
  const nextEvent = events.find((e) => e.event_date >= today);
  const current = currentThresholds(thresholds, today);
  const keyThresholds = THRESHOLD_DEFS.filter((d) => ["bike.ftp_w", "run.threshold_pace_s_per_km", "swim.css_s_per_100m"].includes(d.key));

  return (
    <div className="space-y-6">
      {params.joined === "1" ? <Notice tone="success">Invitation acceptée : votre coach peut désormais suivre et planifier votre entraînement.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Prochaines séances">
          {sessions.length === 0 ? (
            <EmptyState title="Aucune séance programmée">
              Les séances publiées par votre coach apparaîtront ici. Le calendrier complet arrive avec la prochaine version.
            </EmptyState>
          ) : (
            <ul className="-my-3 divide-y divide-line">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <SportDot sport={s.sport as SessionSport} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.title}</p>
                    <p className="text-sm text-muted">
                      {s.scheduled_date === today ? "Aujourd'hui" : formatLocalDate(s.scheduled_date)}
                      {s.start_time ? ` à ${s.start_time.slice(0, 5)}` : ""}
                      {s.objective ? `, ${OBJECTIVE_LABELS[s.objective as SessionObjective].toLowerCase()}` : ""}
                    </p>
                  </div>
                  <p className="tabular shrink-0 text-right text-sm">
                    {s.planned_duration_s ? formatDuration(s.planned_duration_s) : "durée libre"}
                    {s.planned_distance_m ? (
                      <span className="block text-muted">{formatDistance(Number(s.planned_distance_m), s.sport === "swim" ? "swim" : undefined)}</span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Objectif">
            {nextEvent ? (
              <div className="flex items-center gap-3">
                <PriorityBadge priority={nextEvent.priority} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{nextEvent.name}</p>
                  <p className="text-sm text-muted">{formatLocalDate(nextEvent.event_date)}</p>
                </div>
                <p className="tabular text-[22px] font-semibold">J-{daysBetween(today, nextEvent.event_date)}</p>
              </div>
            ) : (
              <EmptyState title="Pas de compétition prévue" action={<Link href="/athlete/profile" className="text-sm font-medium text-accent">Ajouter une compétition</Link>} />
            )}
          </Panel>

          <Panel title="Seuils actuels" actions={<Link href="/athlete/profile" className="text-sm font-medium text-accent">Mettre à jour</Link>}>
            <ul className="divide-y divide-line">
              {keyThresholds.map((def) => {
                const row = current.get(def.key);
                return (
                  <li key={def.key} className="flex items-baseline justify-between py-1.5 text-[15px]">
                    <span>
                      {def.label} <span className="text-sm text-muted">{def.group.toLowerCase()}</span>
                    </span>
                    <span className="tabular font-semibold">{row ? formatThresholdValue(def, row.value) : <span className="font-normal text-muted">non renseigné</span>}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Mon coach" description="Vous choisissez ce que chaque coach peut faire, et vous pouvez retirer son accès à tout moment.">
        {coaches.length === 0 ? (
          <EmptyState title="Pas encore de coach">Demandez à votre coach un lien d’invitation : il suffit de l’ouvrir pour lui donner accès.</EmptyState>
        ) : (
          <ul className="-my-4 divide-y divide-line">
            {coaches.map((link) => (
              <li key={link.id} className="grid gap-4 py-4 sm:grid-cols-[1fr_1.4fr]">
                <div>
                  <p className="font-medium">{link.coach?.display_name ?? "Coach"}</p>
                  <p className="text-sm text-muted">Suivi depuis le {formatLocalDate(localDate(profile.timezone, new Date(link.created_at)))}</p>
                  <form action={revokeCoachLink} className="mt-3">
                    <input type="hidden" name="link_id" value={link.id} />
                    <ConfirmSubmit
                      size="sm"
                      variant="danger"
                      confirmMessage={`Retirer l'accès de ${link.coach?.display_name ?? "ce coach"} ? Il ne verra plus vos données.`}
                    >
                      Retirer l&apos;accès
                    </ConfirmSubmit>
                  </form>
                </div>
                <CoachPermissionsForm linkId={link.id} canEditPlan={link.can_edit_plan} canViewActivities={link.can_view_activities} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
