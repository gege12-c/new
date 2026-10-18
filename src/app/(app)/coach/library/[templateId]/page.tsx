import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { SessionEditor } from "@/components/editor/session-editor";
import { EditorSkeleton } from "@/components/layout/skeletons";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getTemplate } from "@/lib/data/planning";
import { todayIn } from "@/lib/time";

export const metadata: Metadata = { title: "Modèle" };

export default function TemplatePage({ params }: PageProps<"/coach/library/[templateId]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <TemplateEditor params={params} />
    </Suspense>
  );
}

async function TemplateEditor({ params }: Pick<PageProps<"/coach/library/[templateId]">, "params">) {
  const { templateId } = await params;
  if (!z.uuid().safeParse(templateId).success) notFound();
  const [{ supabase }, profile] = await Promise.all([requireSession(`/coach/library/${templateId}`), getProfile()]);
  const template = await getTemplate(supabase, templateId);
  if (!template) notFound();
  const today = await todayIn(profile.timezone);
  return (
    <SessionEditor
      mode="template"
      sessionId={null}
      templateId={template.id}
      state={null}
      base={null}
      values={{
        scheduled_date: today,
        start_time: "",
        title: template.name,
        objective: template.objective ?? "",
        description: template.description ?? "",
        nutrition_notes: "",
        content: template.content,
      }}
      pendingSince={null}
      lastSavedAt={template.updated_at}
      backHref="/coach/library"
      backLabel="Bibliothèque"
      editHrefPattern="/coach/library/{id}"
    />
  );
}
