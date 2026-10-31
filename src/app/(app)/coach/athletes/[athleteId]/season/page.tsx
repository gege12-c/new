import type { Metadata } from "next";
import { Suspense } from "react";
import { AthleteHeader } from "@/components/coach/athlete-header";
import { PageContainer } from "@/components/layout/page";
import { SeasonView } from "@/components/season/season-view";
import { SectionSkeleton } from "@/components/ui/feedback";
import { loadCoachedAthlete } from "@/lib/coach/access";
import { getEvents, getThresholds } from "@/lib/data/athlete";
import { getSeasonData } from "@/lib/data/season";

export const metadata: Metadata = { title: "Saison de l’athlète" };

export default function CoachAthleteSeasonPage({ params }: PageProps<"/coach/athletes/[athleteId]/season">) {
  return (
    <PageContainer wide>
      <Suspense fallback={<SectionSkeleton />}>
        <Season params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Season({ params }: Pick<PageProps<"/coach/athletes/[athleteId]/season">, "params">) {
  const { athleteId } = await params;
  const ctx = await loadCoachedAthlete(athleteId, `/coach/athletes/${athleteId}/season`);
  const [thresholds, events, data] = await Promise.all([
    getThresholds(ctx.supabase, athleteId),
    getEvents(ctx.supabase, athleteId),
    getSeasonData(ctx.supabase, athleteId, ctx.today, { canSeeActivities: ctx.link.can_view_activities }),
  ]);
  return (
    <>
      <AthleteHeader
        athleteId={athleteId}
        name={ctx.athlete.display_name}
        goal={ctx.athleteProfile?.main_goal ?? null}
        thresholds={thresholds}
        nextEvent={events.find((e) => e.event_date >= ctx.today) ?? null}
        today={ctx.today}
        active="season"
        readOnly={!ctx.canPlan}
      />
      <SeasonView data={data} today={ctx.today} calendarBase={`/coach/athletes/${athleteId}`} />
    </>
  );
}
