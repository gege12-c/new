import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityPanel } from "@/components/activities/activity-panel";
import { PlanningCalendar } from "@/components/calendar/planning-calendar";
import { AthleteHeader } from "@/components/coach/athlete-header";
import { PageContainer } from "@/components/layout/page";
import { SessionPanel } from "@/components/planning/session-panel";
import { PlanningLive } from "@/components/realtime/planning-live";
import { CalendarSkeleton } from "@/components/layout/skeletons";
import { Notice } from "@/components/ui/feedback";
import { loadCoachedAthlete } from "@/lib/coach/access";
import { getEvents, getThresholds } from "@/lib/data/athlete";
import { unattachedActivities, withRealization } from "@/lib/activities/realization";
import { getRealizedInRange } from "@/lib/data/activities";
import { getSessionsInRange, getTemplates } from "@/lib/data/planning";
import { calendarHref, readCalendarQuery } from "@/lib/planning/calendar-query";
import { viewRange } from "@/lib/planning/dates";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";

export const metadata: Metadata = { title: "Calendrier de l’athlète" };

export default function CoachAthleteCalendarPage({ params, searchParams }: PageProps<"/coach/athletes/[athleteId]">) {
  return (
    <PageContainer wide>
      <Suspense fallback={<CalendarSkeleton />}>
        <CoachAthleteCalendar params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function CoachAthleteCalendar({ params, searchParams }: PageProps<"/coach/athletes/[athleteId]">) {
  const { athleteId } = await params;
  const basePath = `/coach/athletes/${athleteId}`;
  const [ctx, sp] = await Promise.all([loadCoachedAthlete(athleteId, basePath), searchParams]);
  const query = readCalendarQuery(sp, ctx.today, "month");
  const { from, to } = viewRange(query.view, query.date);
  const [planned, realized, thresholdRows, events, templates] = await Promise.all([
    getSessionsInRange(ctx.supabase, athleteId, from, to, { withPending: true }),
    getRealizedInRange(ctx.supabase, athleteId, from, to),
    getThresholds(ctx.supabase, athleteId),
    getEvents(ctx.supabase, athleteId),
    ctx.canPlan ? getTemplates(ctx.supabase, ctx.userId) : Promise.resolve([]),
  ]);
  const sessions = withRealization(planned, realized);
  const thresholds = toAthleteThresholds(currentThresholds(thresholdRows, ctx.today));
  const nextEvent = events.find((e) => e.event_date >= ctx.today) ?? null;

  return (
    <>
      <AthleteHeader
        athleteId={athleteId}
        name={ctx.athlete.display_name}
        goal={ctx.athleteProfile?.main_goal ?? null}
        thresholds={thresholdRows}
        nextEvent={nextEvent}
        today={ctx.today}
        active="calendar"
        readOnly={!ctx.canPlan}
      />
      {!ctx.canPlan ? (
        <Notice tone="warning" className="mb-4">
          {ctx.athlete.display_name} ne vous autorise pas à planifier : le calendrier est en lecture seule.
        </Notice>
      ) : null}
      <PlanningCalendar
        mode="coach"
        athleteId={athleteId}
        basePath={basePath}
        query={query}
        today={ctx.today}
        sessions={sessions}
        activities={unattachedActivities(realized)}
        events={events.filter((e) => e.event_date >= from && e.event_date <= to)}
        thresholds={thresholds}
        canMove={ctx.canPlan}
        canCreate={ctx.canPlan}
        newSessionPath={ctx.canPlan ? `${basePath}/sessions/new` : undefined}
        templates={templates}
        toolbarExtra={<PlanningLive athleteId={athleteId} strava={ctx.link.share_strava} className="order-first w-full sm:order-none sm:w-auto" />}
      />
      {query.session ? (
        <SessionPanel
          supabase={ctx.supabase}
          sessionId={query.session}
          viewerId={ctx.userId}
          viewer="coach"
          today={ctx.today}
          timeZone={ctx.athlete.timezone}
          thresholds={thresholds}
          closeHref={calendarHref(basePath, query, { session: null })}
          editHref={`${basePath}/sessions/${query.session}`}
          canPlan={ctx.canPlan}
          stravaShared={ctx.link.share_strava}
        />
      ) : query.activity ? (
        <ActivityPanel
          supabase={ctx.supabase}
          activityId={query.activity}
          viewer="coach"
          canPlan={ctx.canPlan}
          timeZone={ctx.athlete.timezone}
          closeHref={calendarHref(basePath, query, { activity: null })}
          sessionHref={(id) => calendarHref(basePath, query, { session: id })}
        />
      ) : null}
    </>
  );
}
