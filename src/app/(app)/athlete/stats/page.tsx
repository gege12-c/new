import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page";
import { StatsView } from "@/components/stats/stats-view";
import { SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getStatsData } from "@/lib/data/stats";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Progression" };

export default function AthleteStatsPage() {
  return (
    <PageContainer>
      <PageHeader title="Progression" description="Vos volumes, l’intensité prévue, le suivi de vos séances, vos seuils et vos records." />
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteStats />
      </Suspense>
    </PageContainer>
  );
}

async function AthleteStats() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/athlete/stats"), getProfile()]);
  const today = await todayIn(profile.timezone);
  const data = await getStatsData(supabase, userId, today);
  return <StatsView data={data} today={today} viewer="athlete" canSeeFiles />;
}
