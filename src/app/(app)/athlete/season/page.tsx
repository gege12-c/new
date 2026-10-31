import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page";
import { SeasonView } from "@/components/season/season-view";
import { SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getSeasonData } from "@/lib/data/season";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Saison" };

export default function AthleteSeasonPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Saison" description="Huit semaines passées et six mois à venir : volume prévu par discipline, réalisé, compétitions et jours indisponibles." />
      <Suspense fallback={<SectionSkeleton />}>
        <Season />
      </Suspense>
    </PageContainer>
  );
}

async function Season() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/athlete/season"), getProfile()]);
  const today = await todayIn(profile.timezone);
  const data = await getSeasonData(supabase, userId, today, { canSeeActivities: true });
  return <SeasonView data={data} today={today} calendarBase="/athlete/calendar" />;
}
