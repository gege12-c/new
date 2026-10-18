import type { Metadata } from "next";
import { Suspense } from "react";
import { AthleteProfileForm } from "@/components/athlete/athlete-profile-form";
import { EventsPanel } from "@/components/athlete/events-panel";
import { ThresholdsPanel } from "@/components/athlete/thresholds-panel";
import { SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getAthleteProfile, getEvents, getThresholds } from "@/lib/data/athlete";
import { localDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Profil sportif" };

export default function AthleteProfilePage() {
  return (
    <>
      <PageHeader title="Profil sportif" description="Vos objectifs, vos seuils et vos compétitions, partagés avec votre coach." />
      <Suspense fallback={<SectionSkeleton />}>
        <ProfileContent />
      </Suspense>
    </>
  );
}

async function ProfileContent() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/athlete/profile"), getProfile()]);
  const today = localDate(profile.timezone);
  const [athleteProfile, thresholds, events] = await Promise.all([
    getAthleteProfile(supabase, userId),
    getThresholds(supabase, userId),
    getEvents(supabase, userId),
  ]);

  return (
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
      <ThresholdsPanel athleteId={userId} rows={thresholds} today={today} canEdit />
      <EventsPanel athleteId={userId} events={events} today={today} canEdit />
    </div>
  );
}
