import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page";
import { StatsView } from "@/components/stats/stats-view";
import { MeasuresPanel } from "@/components/stats/measures-panel";
import { WellnessPanel } from "@/components/stats/wellness-panel";
import { SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getStatsData } from "@/lib/data/stats";
import { getWellness } from "@/lib/data/wellness";
import { addDays } from "@/lib/planning/dates";
import { todayIn } from "@/lib/time";
import { MEASURE_DAYS } from "@/lib/wellness/trends";

export const metadata: Metadata = { title: "Progression" };

export default function AthleteStatsPage() {
  return (
    <PageContainer>
      <PageHeader title="Progression" description="Vos volumes, l’intensité prévue, le suivi de vos séances, vos seuils, vos records et votre forme du jour." />
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteStats />
      </Suspense>
    </PageContainer>
  );
}

async function AthleteStats() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/athlete/stats"), getProfile()]);
  const today = await todayIn(profile.timezone);
  const [data, wellness] = await Promise.all([getStatsData(supabase, userId, today), getWellness(supabase, userId, addDays(today, -(MEASURE_DAYS - 1)), today)]);
  return (
    <div className="space-y-6">
      <StatsView data={data} today={today} viewer="athlete" canSeeFiles canEditThresholds />
      <MeasuresPanel entries={wellness} today={today} viewer="athlete" />
      <WellnessPanel entries={wellness} today={today} viewer="athlete" />
    </div>
  );
}
