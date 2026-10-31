import { todayIn } from "@/lib/time";
import { PageContainer } from "@/components/layout/page";
import type { Metadata } from "next";
import { Suspense } from "react";
import { revokeCoachLink } from "@/app/(app)/actions";
import { AthleteProfileForm } from "@/components/athlete/athlete-profile-form";
import { ConnectionsPanel } from "@/components/athlete/connections-panel";
import { CoachPermissionsForm } from "@/components/athlete/coach-permissions-form";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EventsPanel } from "@/components/athlete/events-panel";
import { DevicesPanel } from "@/components/exports/devices-panel";
import { StravaSharingForm } from "@/components/athlete/strava-sharing-form";
import { WatchSyncPanel } from "@/components/athlete/watch-sync-panel";
import { CalendarFeedPanel } from "@/components/athlete/calendar-feed-panel";
import { ThresholdsPanel } from "@/components/athlete/thresholds-panel";
import { WatchPanel } from "@/components/athlete/watch-panel";
import { EmptyState, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getAthleteProfile, getEvents, getMyCoaches, getThresholds } from "@/lib/data/athlete";
import { formatLocalDate, localDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Profil sportif" };

/** Raccourcis vers les rubriques, dans l'ordre d'usage. */
const SECTIONS = [
  ["#seuils", "Seuils"],
  ["#montre-auto", "Montre"],
  ["#competitions", "Compétitions"],
  ["#objectifs", "Objectifs"],
  ["#connexions", "Strava"],
  ["#agenda", "Agenda"],
  ["#coach", "Coach"],
] as const;

export default function AthleteProfilePage({ searchParams }: PageProps<"/athlete/profile">) {
  return (
    <PageContainer wide>
      <PageHeader title="Profil sportif" description="Vos objectifs, vos seuils, vos compétitions et vos activités, partagés avec votre coach." />
      <Suspense fallback={<SectionSkeleton />}>
        <ProfileContent searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function ProfileContent({ searchParams }: Pick<PageProps<"/athlete/profile">, "searchParams">) {
  const [{ supabase, userId }, profile, params] = await Promise.all([requireSession("/athlete/profile"), getProfile(), searchParams]);
  const today = await todayIn(profile.timezone);
  const [athleteProfile, thresholds, events, coaches] = await Promise.all([
    getAthleteProfile(supabase, userId),
    getThresholds(supabase, userId),
    getEvents(supabase, userId),
    getMyCoaches(supabase, userId),
  ]);

  // Téléphone : une seule colonne, seuils et montre d'abord (order) ; ordinateur : deux colonnes.
  return (
    <div className="space-y-5">
      <nav aria-label="Rubriques du profil" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {SECTIONS.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink-soft hover:border-ink/40 hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <div className="contents xl:block xl:space-y-6">
          <div className="order-1 xl:order-none">
            <ThresholdsPanel athleteId={userId} rows={thresholds} today={today} canEdit />
          </div>
          <div className="order-3 xl:order-none">
            <EventsPanel athleteId={userId} events={events} today={today} canEdit />
          </div>
          <Panel id="objectifs" title="Objectifs" className="order-4 xl:order-none">
            <AthleteProfileForm
              values={{
                main_goal: athleteProfile?.main_goal ?? null,
                experience_level: athleteProfile?.experience_level ?? null,
                weekly_hours_target: athleteProfile?.weekly_hours_target ?? null,
                notes: athleteProfile?.notes ?? null,
              }}
            />
          </Panel>
        </div>
        <div className="contents xl:block xl:space-y-6">
          <div className="order-2 xl:order-none">
            <WatchSyncPanel
              supabase={supabase}
              userId={userId}
              timeZone={profile.timezone}
              suuntoCallback={typeof params.suunto === "string" ? params.suunto : undefined}
              intervalsCallback={typeof params.intervals === "string" ? params.intervals : undefined}
            />
          </div>
          <div className="order-5 xl:order-none">
            <ConnectionsPanel supabase={supabase} timeZone={profile.timezone} callbackStatus={typeof params.strava === "string" ? params.strava : undefined} />
          </div>
          <div className="order-6 space-y-6 xl:order-none">
            <CalendarFeedPanel supabase={supabase} userId={userId} timeZone={profile.timezone} />
            <WatchPanel supabase={supabase} timeZone={profile.timezone} />
            <DevicesPanel />
            <Panel id="coach" title="Mon coach" description="Vous choisissez ce que chaque coach peut faire, et vous pouvez retirer son accès à tout moment.">
              {coaches.length === 0 ? (
                <EmptyState title="Pas encore de coach">Demandez à votre coach un lien d’invitation : il suffit de l’ouvrir pour lui donner accès.</EmptyState>
              ) : (
                <ul className="-my-4 divide-y divide-line">
                  {coaches.map((link) => (
                    <li key={link.id} className="grid gap-4 py-4 sm:grid-cols-[1fr_1.4fr]">
                      <div>
                        <p className="font-semibold">{link.coach?.display_name ?? "Coach"}</p>
                        <p className="text-[13px] text-muted">Suivi depuis le {formatLocalDate(localDate(profile.timezone, new Date(link.created_at)))}</p>
                        <form action={revokeCoachLink} className="mt-3">
                          <input type="hidden" name="link_id" value={link.id} />
                          <ConfirmSubmit
                            size="sm"
                            variant="danger"
                            confirmMessage={`Retirer l’accès de ${link.coach?.display_name ?? "ce coach"} ? Il ne verra plus vos données.`}
                          >
                            Retirer l’accès
                          </ConfirmSubmit>
                        </form>
                      </div>
                      <div className="space-y-3">
                        <CoachPermissionsForm linkId={link.id} canEditPlan={link.can_edit_plan} canViewActivities={link.can_view_activities} />
                        <StravaSharingForm
                          linkId={link.id}
                          coachName={link.coach?.display_name ?? "Votre coach"}
                          sharedAt={link.share_strava ? link.strava_shared_at : null}
                          timeZone={profile.timezone}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
