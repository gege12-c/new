import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityPanel } from "@/components/activities/activity-panel";
import { PlanningCalendar, SportStatusFilters } from "@/components/calendar/planning-calendar";
import { PageContainer } from "@/components/layout/page";
import { CalendarSkeleton } from "@/components/layout/skeletons";
import { SessionPanel } from "@/components/planning/session-panel";
import { PlanningLive } from "@/components/realtime/planning-live";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getEvents, getThresholds } from "@/lib/data/athlete";
import { unattachedActivities, withRealization } from "@/lib/activities/realization";
import { getRealizedInRange } from "@/lib/data/activities";
import { getSessionsInRange } from "@/lib/data/planning";
import { calendarHref, readCalendarQuery } from "@/lib/planning/calendar-query";
import { viewRange } from "@/lib/planning/dates";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { todayIn } from "@/lib/time";
import type { SessionSport } from "@/lib/workout/schema";

export const metadata: Metadata = { title: "Calendrier" };

const BASE = "/athlete/calendar";

export default function AthleteCalendarPage({ searchParams }: PageProps<"/athlete/calendar">) {
  return (
    <PageContainer wide>
      <Suspense fallback={<CalendarSkeleton />}>
        <AthleteCalendar searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function AthleteCalendar({ searchParams }: Pick<PageProps<"/athlete/calendar">, "searchParams">) {
  const [{ supabase, userId }, profile, sp] = await Promise.all([requireSession(BASE), getProfile(), searchParams]);
  const today = await todayIn(profile.timezone);
  const query = readCalendarQuery(sp, today, "week");
  // Les brouillons du coach ne sont jamais montrés à l’athlète (la RLS les exclut déjà).
  query.statuses = query.statuses?.filter((s) => s !== "draft");
  const { from, to } = viewRange(query.view, query.date);
  const [planned, realized, thresholdRows, events] = await Promise.all([
    getSessionsInRange(supabase, userId, from, to),
    getRealizedInRange(supabase, userId, from, to),
    getThresholds(supabase, userId),
    getEvents(supabase, userId),
  ]);
  const sessions = withRealization(planned, realized);
  const thresholds = toAthleteThresholds(currentThresholds(thresholdRows, today));
  const sports: SessionSport[] = ["swim", "bike", "run", "brick", "strength", "other"];

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-[30px] sm:text-[36px]">Calendrier</h1>
        <PlanningLive athleteId={userId} self />
      </header>
      <SportStatusFilters basePath={BASE} query={query} sports={sports} />
      <PlanningCalendar
        mode="athlete"
        athleteId={userId}
        basePath={BASE}
        query={query}
        today={today}
        sessions={sessions}
        activities={unattachedActivities(realized)}
        events={events.filter((e) => e.event_date >= from && e.event_date <= to)}
        thresholds={thresholds}
        canMove
        canCreate
        newSessionPath="/athlete/sessions/new"
      />
      {query.session ? (
        <SessionPanel
          supabase={supabase}
          sessionId={query.session}
          viewerId={userId}
          viewer="athlete"
          today={today}
          timeZone={profile.timezone}
          thresholds={thresholds}
          closeHref={calendarHref(BASE, query, { session: null })}
          editHref={`/athlete/sessions/${query.session}`}
          canPlan={false}
        />
      ) : query.activity ? (
        <ActivityPanel
          supabase={supabase}
          activityId={query.activity}
          viewer="athlete"
          canPlan={false}
          timeZone={profile.timezone}
          closeHref={calendarHref(BASE, query, { activity: null })}
          sessionHref={(id) => calendarHref(BASE, query, { session: id })}
        />
      ) : null}
    </>
  );
}
