import type { Metadata } from "next";
import { Suspense } from "react";
import { AthleteHeader } from "@/components/coach/athlete-header";
import { PageContainer } from "@/components/layout/page";
import { StatsView } from "@/components/stats/stats-view";
import { SectionSkeleton } from "@/components/ui/feedback";
import { loadCoachedAthlete } from "@/lib/coach/access";
import { getEvents } from "@/lib/data/athlete";
import { getStatsData } from "@/lib/data/stats";
import { getThresholds } from "@/lib/data/athlete";

export const metadata: Metadata = { title: "Progression de l’athlète" };

export default function CoachAthleteStatsPage({ params }: PageProps<"/coach/athletes/[athleteId]/stats">) {
  return (
    <PageContainer wide>
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteStats params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function AthleteStats({ params }: Pick<PageProps<"/coach/athletes/[athleteId]/stats">, "params">) {
  const { athleteId } = await params;
  const ctx = await loadCoachedAthlete(athleteId, `/coach/athletes/${athleteId}/stats`);
  const [thresholds, events, data] = await Promise.all([getThresholds(ctx.supabase, athleteId), getEvents(ctx.supabase, athleteId), getStatsData(ctx.supabase, athleteId, ctx.today)]);
  return (
    <>
      <AthleteHeader
        athleteId={athleteId}
        name={ctx.athlete.display_name}
        goal={ctx.athleteProfile?.main_goal ?? null}
        thresholds={thresholds}
        nextEvent={events.find((e) => e.event_date >= ctx.today) ?? null}
        today={ctx.today}
        active="stats"
        readOnly={!ctx.canPlan}
      />
      <StatsView data={data} today={ctx.today} viewer="coach" canSeeFiles={ctx.link.can_view_activities} />
    </>
  );
}
