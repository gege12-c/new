import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { SessionEditor } from "@/components/editor/session-editor";
import { loadCoachedAthlete } from "@/lib/coach/access";
import { getSessionDetail, getThresholdsOn } from "@/lib/data/planning";
import { calendarHref } from "@/lib/planning/calendar-query";
import { snapshotToValues } from "@/lib/planning/editor-values";
import { EditorSkeleton } from "@/components/layout/skeletons";

export const metadata: Metadata = { title: "Modifier la séance" };

export default function EditSessionPage({ params }: PageProps<"/coach/athletes/[athleteId]/sessions/[sessionId]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditSession params={params} />
    </Suspense>
  );
}

async function EditSession({ params }: Pick<PageProps<"/coach/athletes/[athleteId]/sessions/[sessionId]">, "params">) {
  const { athleteId, sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const basePath = `/coach/athletes/${athleteId}`;
  const ctx = await loadCoachedAthlete(athleteId, `${basePath}/sessions/${sessionId}`);
  const detail = await getSessionDetail(ctx.supabase, sessionId, { withDraft: true });
  if (!detail || detail.athlete_id !== athleteId) notFound();

  const source = detail.draft?.payload ?? detail.snapshot;
  const thresholds = await getThresholdsOn(ctx.supabase, athleteId, source.scheduled_date);
  return (
    <SessionEditor
      mode="session"
      athlete={{ id: athleteId, name: ctx.athlete.display_name, thresholds }}
      sessionId={detail.id}
      templateId={detail.template_id}
      state={detail.state}
      base={source}
      values={snapshotToValues(source)}
      pendingSince={detail.draft?.updated_at ?? null}
      lastSavedAt={detail.updated_at}
      backHref={calendarHref(basePath, { view: "week", date: source.scheduled_date, session: detail.id })}
      backLabel={`Calendrier de ${ctx.athlete.display_name.split(" ")[0]}`}
      editHrefPattern={`${basePath}/sessions/{id}`}
    />
  );
}
