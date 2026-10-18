import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { SessionEditor } from "@/components/editor/session-editor";
import { EditorSkeleton } from "@/components/layout/skeletons";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getSessionDetail, getThresholdsOn } from "@/lib/data/planning";
import { calendarHref } from "@/lib/planning/calendar-query";
import { snapshotToValues } from "@/lib/planning/editor-values";

export const metadata: Metadata = { title: "Modifier la séance" };

export default function EditOwnSessionPage({ params }: PageProps<"/athlete/sessions/[sessionId]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditOwnSession params={params} />
    </Suspense>
  );
}

async function EditOwnSession({ params }: Pick<PageProps<"/athlete/sessions/[sessionId]">, "params">) {
  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const [{ supabase, userId }, profile] = await Promise.all([requireSession(`/athlete/sessions/${sessionId}`), getProfile()]);
  const detail = await getSessionDetail(supabase, sessionId, { withDraft: true });
  if (!detail || detail.athlete_id !== userId) notFound();
  // Les séances du coach se consultent (et se déplacent) depuis le calendrier : leur contenu reste au coach.
  if (detail.created_by !== userId) redirect(calendarHref("/athlete/calendar", { view: "day", date: detail.scheduled_date, session: detail.id }));

  const source = detail.draft?.payload ?? detail.snapshot;
  const thresholds = await getThresholdsOn(supabase, userId, source.scheduled_date);
  return (
    <SessionEditor
      mode="session"
      athlete={{ id: userId, name: profile.display_name, thresholds }}
      sessionId={detail.id}
      templateId={detail.template_id}
      state={detail.state}
      base={source}
      values={snapshotToValues(source)}
      pendingSince={detail.draft?.updated_at ?? null}
      lastSavedAt={detail.updated_at}
      backHref={calendarHref("/athlete/calendar", { view: "week", date: source.scheduled_date, session: detail.id })}
      backLabel="Calendrier"
      editHrefPattern="/athlete/sessions/{id}"
    />
  );
}
