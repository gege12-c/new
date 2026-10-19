import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionEditor } from "@/components/editor/session-editor";
import { EditorSkeleton } from "@/components/layout/skeletons";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getThresholdsOn } from "@/lib/data/planning";
import { calendarHref } from "@/lib/planning/calendar-query";
import { isISODate } from "@/lib/planning/dates";
import { todayIn } from "@/lib/time";
import { defaultWorkout } from "@/lib/workout/edit";
import { SESSION_SPORTS, SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";

export const metadata: Metadata = { title: "Nouvelle séance" };

/** L’athlète planifie ses propres séances (la RLS l’autorise pour lui-même uniquement). */
export default function NewOwnSessionPage({ searchParams }: PageProps<"/athlete/sessions/new">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewOwnSession searchParams={searchParams} />
    </Suspense>
  );
}

async function NewOwnSession({ searchParams }: Pick<PageProps<"/athlete/sessions/new">, "searchParams">) {
  const [{ supabase, userId }, profile, sp] = await Promise.all([requireSession("/athlete/sessions/new"), getProfile(), searchParams]);
  const today = await todayIn(profile.timezone);
  const date = isISODate(sp.date) ? sp.date : today;
  const sport: SessionSport = typeof sp.sport === "string" && (SESSION_SPORTS as readonly string[]).includes(sp.sport) ? (sp.sport as SessionSport) : "run";
  const thresholds = await getThresholdsOn(supabase, userId, date);
  return (
    <SessionEditor
      mode="session"
      self
      athlete={{ id: userId, name: profile.display_name, thresholds }}
      sessionId={null}
      templateId={null}
      state={null}
      base={null}
      values={{
        scheduled_date: date,
        start_time: "",
        title: SPORT_LABELS[sport],
        objective: "",
        description: "",
        nutrition_notes: "",
        content: defaultWorkout(sport, thresholds),
      }}
      pendingSince={null}
      lastSavedAt={null}
      backHref={calendarHref("/athlete/calendar", { view: "week", date })}
      backLabel="Calendrier"
      editHrefPattern="/athlete/sessions/{id}"
    />
  );
}
