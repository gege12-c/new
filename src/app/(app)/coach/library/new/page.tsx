import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionEditor } from "@/components/editor/session-editor";
import { EditorSkeleton } from "@/components/layout/skeletons";
import { getProfile } from "@/lib/auth/dal";
import { todayIn } from "@/lib/time";
import { defaultWorkout } from "@/lib/workout/edit";
import { SESSION_SPORTS, SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";

export const metadata: Metadata = { title: "Nouveau modèle" };

export default function NewTemplatePage({ searchParams }: PageProps<"/coach/library/new">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewTemplate searchParams={searchParams} />
    </Suspense>
  );
}

async function NewTemplate({ searchParams }: Pick<PageProps<"/coach/library/new">, "searchParams">) {
  const [profile, sp] = await Promise.all([getProfile(), searchParams]);
  const sport: SessionSport = typeof sp.sport === "string" && (SESSION_SPORTS as readonly string[]).includes(sp.sport) ? (sp.sport as SessionSport) : "bike";
  const today = await todayIn(profile.timezone);
  return (
    <SessionEditor
      mode="template"
      sessionId={null}
      templateId={null}
      state={null}
      base={null}
      values={{
        scheduled_date: today,
        start_time: "",
        title: `${SPORT_LABELS[sport]} – nouveau modèle`,
        objective: "",
        description: "",
        nutrition_notes: "",
        content: defaultWorkout(sport),
      }}
      pendingSince={null}
      lastSavedAt={null}
      backHref="/coach/library"
      backLabel="Bibliothèque"
      editHrefPattern="/coach/library/{id}"
    />
  );
}
