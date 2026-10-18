import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page";
import { TemplateActions } from "@/components/library/template-actions";
import { SPORT_ICONS, SPORT_STYLES } from "@/components/sport";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { WorkoutProfile } from "@/components/workout/workout-profile";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getCoachedAthletes } from "@/lib/data/coach";
import { getTemplates } from "@/lib/data/planning";
import { todayIn } from "@/lib/time";
import { formatDurationShort, summarizeNodes } from "@/lib/workout/format";
import { OBJECTIVE_LABELS, SESSION_SPORTS, SPORT_LABELS, type SessionObjective } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bibliothèque" };

export default function LibraryPage() {
  return (
    <PageContainer wide>
      <PageHeader
        title="Bibliothèque"
        description="Vos séances types, prêtes à planifier : leurs cibles relatives s’adaptent aux seuils de chaque athlète."
        actions={
          <ButtonLink href="/coach/library/new">
            <Plus aria-hidden />
            Nouveau modèle
          </ButtonLink>
        }
      />
      <Suspense fallback={<SectionSkeleton />}>
        <Library />
      </Suspense>
    </PageContainer>
  );
}

async function Library() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/coach/library"), getProfile()]);
  const [templates, links, today] = await Promise.all([getTemplates(supabase, userId), getCoachedAthletes(supabase, userId), todayIn(profile.timezone)]);
  const athletes = links.filter((l) => l.can_edit_plan).map((l) => ({ id: l.athlete_id, name: l.athlete?.display_name ?? "Athlète" }));

  if (!templates.length) {
    return (
      <EmptyState title="Aucun modèle pour l’instant" action={<ButtonLink href="/coach/library/new">Créer un modèle</ButtonLink>}>
        Créez un modèle ici, ou enregistrez une séance existante comme modèle depuis l’éditeur.
      </EmptyState>
    );
  }

  const groups = SESSION_SPORTS.map((sport) => ({ sport, items: templates.filter((t) => t.sport === sport) })).filter((g) => g.items.length);
  return (
    <div className="space-y-8">
      {groups.map(({ sport, items }) => {
        const Icon = SPORT_ICONS[sport];
        return (
          <section key={sport} aria-labelledby={`lib-${sport}`}>
            <h2 id={`lib-${sport}`} className="heading mb-3 flex items-center gap-2 text-[18px]">
              <span className={cn("flex size-7 items-center justify-center rounded-full", SPORT_STYLES[sport].soft, SPORT_STYLES[sport].ink)}>
                <Icon className="size-4" aria-hidden />
              </span>
              {SPORT_LABELS[sport]}
              <span className="figure text-[14px] text-muted">{items.length}</span>
            </h2>
            <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {items.map((template) => (
                <li key={template.id} className="flex flex-col rounded-[14px] border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/coach/library/${template.id}`} className="heading block truncate text-[16px] hover:underline">
                        {template.name}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-muted">
                        {template.objective ? OBJECTIVE_LABELS[template.objective as SessionObjective] : "Sans objectif précis"}
                      </p>
                    </div>
                    <span className="figure shrink-0 text-[17px]">{template.planned_duration_s ? formatDurationShort(template.planned_duration_s) : "—"}</span>
                  </div>
                  <WorkoutProfile workout={template.content} height={44} compact className="mt-3 text-ink" />
                  <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">
                    {template.content.segments.map((segment) => summarizeNodes(segment.steps, segment.sport)).join(" puis ")}
                  </p>
                  <div className="mt-auto pt-4">
                    <TemplateActions templateId={template.id} athletes={athletes} today={today} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
