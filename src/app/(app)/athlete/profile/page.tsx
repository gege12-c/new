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
import { ThresholdsPanel } from "@/components/athlete/thresholds-panel";
import { EmptyState, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getAthleteProfile, getEvents, getMyCoaches, getThresholds } from "@/lib/data/athlete";
import { formatLocalDate, localDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Profil sportif" };

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

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
      <Panel title="Objectifs">
        <AthleteProfileForm
          values={{
            main_goal: athleteProfile?.main_goal ?? null,
            experience_level: athleteProfile?.experience_level ?? null,
            weekly_hours_target: athleteProfile?.weekly_hours_target ?? null,
            notes: athleteProfile?.notes ?? null,
          }}
        />
      </Panel>
      <EventsPanel athleteId={userId} events={events} today={today} canEdit />
      </div>
      <div className="space-y-6">
      <ThresholdsPanel athleteId={userId} rows={thresholds} today={today} canEdit />
      <ConnectionsPanel supabase={supabase} timeZone={profile.timezone} callbackStatus={typeof params.strava === "string" ? params.strava : undefined} />
      <DevicesPanel />
      <Panel title="Mon coach" description="Vous choisissez ce que chaque coach peut faire, et vous pouvez retirer son accès à tout moment.">
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
                <CoachPermissionsForm linkId={link.id} canEditPlan={link.can_edit_plan} canViewActivities={link.can_view_activities} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      </div>
    </div>
  );
}
