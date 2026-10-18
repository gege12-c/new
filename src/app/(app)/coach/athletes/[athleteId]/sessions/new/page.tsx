import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionEditor } from "@/components/editor/session-editor";
import { PageContainer } from "@/components/layout/page";
import { EditorSkeleton } from "@/components/layout/skeletons";
import { Notice } from "@/components/ui/feedback";
import { loadCoachedAthlete } from "@/lib/coach/access";
import { getTemplate, getThresholdsOn } from "@/lib/data/planning";
import { calendarHref } from "@/lib/planning/calendar-query";
import { isISODate } from "@/lib/planning/dates";
import type { EditorValues } from "@/lib/planning/editor-values";
import { defaultWorkout } from "@/lib/workout/edit";
import { SESSION_SPORTS, SPORT_LABELS, WorkoutSchema, type SessionSport } from "@/lib/workout/schema";

export const metadata: Metadata = { title: "Nouvelle séance" };

export default function NewSessionPage({ params, searchParams }: PageProps<"/coach/athletes/[athleteId]/sessions/new">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewSession params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewSession({ params, searchParams }: PageProps<"/coach/athletes/[athleteId]/sessions/new">) {
  const { athleteId } = await params;
  const basePath = `/coach/athletes/${athleteId}`;
  const [ctx, sp] = await Promise.all([loadCoachedAthlete(athleteId, `${basePath}/sessions/new`), searchParams]);
  if (!ctx.canPlan) {
    return (
      <PageContainer>
        <Notice tone="warning">{ctx.athlete.display_name} ne vous autorise pas à planifier ses séances.</Notice>
      </PageContainer>
    );
  }
  const date = isISODate(sp.date) ? sp.date : ctx.today;
  const sport: SessionSport = typeof sp.sport === "string" && (SESSION_SPORTS as readonly string[]).includes(sp.sport) ? (sp.sport as SessionSport) : "bike";
  const template = typeof sp.template === "string" ? await getTemplate(ctx.supabase, sp.template).catch(() => null) : null;
  const templateContent = template ? WorkoutSchema.safeParse(template.content) : null;

  const values: EditorValues =
    template && templateContent?.success
      ? {
          scheduled_date: date,
          start_time: "",
          title: template.name,
          objective: template.objective ?? "",
          description: template.description ?? "",
          nutrition_notes: "",
          content: templateContent.data,
        }
      : {
          scheduled_date: date,
          start_time: "",
          title: SPORT_LABELS[sport],
          objective: "",
          description: "",
          nutrition_notes: "",
          content: defaultWorkout(sport),
        };

  const thresholds = await getThresholdsOn(ctx.supabase, athleteId, date);
  return (
    <SessionEditor
      mode="session"
      athlete={{ id: athleteId, name: ctx.athlete.display_name, thresholds }}
      sessionId={null}
      templateId={template?.id ?? null}
      state={null}
      base={null}
      values={values}
      pendingSince={null}
      lastSavedAt={null}
      backHref={calendarHref(basePath, { view: "week", date })}
      backLabel={`Calendrier de ${ctx.athlete.display_name.split(" ")[0]}`}
      editHrefPattern={`${basePath}/sessions/{id}`}
    />
  );
}
