import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { revokeCoachLink } from "@/app/(app)/actions";
import { EventsPanel } from "@/components/athlete/events-panel";
import { ThresholdsPanel } from "@/components/athlete/thresholds-panel";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState, Notice, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { EXPERIENCE_LABELS, getAthleteProfile, getEvents, getThresholds } from "@/lib/data/athlete";
import { getCoachLink } from "@/lib/data/coach";
import { localDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Fiche athlète" };

export default function CoachAthletePage({ params }: PageProps<"/coach/athletes/[athleteId]">) {
  return (
    <>
      <Link href="/coach" className="mb-4 inline-block text-sm font-medium text-accent">
        Retour aux athlètes
      </Link>
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteCard params={params} />
      </Suspense>
    </>
  );
}

async function AthleteCard({ params }: Pick<PageProps<"/coach/athletes/[athleteId]">, "params">) {
  const { athleteId } = await params;
  if (!z.uuid().safeParse(athleteId).success) notFound();

  const [{ supabase, userId }, coachProfile] = await Promise.all([requireSession(`/coach/athletes/${athleteId}`), getProfile()]);
  const link = await getCoachLink(supabase, userId, athleteId);
  // Sans relation active, la RLS ne renverrait de toute façon aucune donnée.
  if (!link) notFound();

  const [{ data: athlete }, athleteProfile, thresholds, events] = await Promise.all([
    supabase.from("profiles").select("display_name, timezone").eq("id", athleteId).single(),
    getAthleteProfile(supabase, athleteId),
    getThresholds(supabase, athleteId),
    getEvents(supabase, athleteId),
  ]);
  if (!athlete) notFound();

  const today = localDate(athlete.timezone);
  const canEdit = link.can_edit_plan;

  return (
    <>
      <PageHeader
        title={athlete.display_name}
        description={athleteProfile?.main_goal ?? "Objectif non renseigné"}
      />
      {!canEdit ? (
        <Notice tone="warning" className="mb-6">
          Lecture seule : cet athlète ne vous a pas autorisé à planifier ni à modifier ses seuils.
        </Notice>
      ) : null}
      {athlete.timezone !== coachProfile.timezone ? (
        <Notice className="mb-6">Fuseau horaire de l&apos;athlète : {athlete.timezone}. Les dates sont affichées dans son fuseau.</Notice>
      ) : null}

      <div className="space-y-6">
        <Panel title="Profil">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted">Niveau</dt>
              <dd className="font-medium">{athleteProfile?.experience_level ? EXPERIENCE_LABELS[athleteProfile.experience_level] : "Non précisé"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Volume visé</dt>
              <dd className="tabular font-medium">
                {athleteProfile?.weekly_hours_target ? `${athleteProfile.weekly_hours_target} h par semaine` : "Non précisé"}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-sm text-muted">Informations de l&apos;athlète</dt>
              <dd className="whitespace-pre-line">{athleteProfile?.notes || "Aucune"}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Calendrier">
          <EmptyState title="Planification bientôt disponible">
            L&apos;éditeur de séances structurées et le calendrier arrivent dans la prochaine version.
          </EmptyState>
        </Panel>

        <ThresholdsPanel athleteId={athleteId} rows={thresholds} today={today} canEdit={canEdit} />
        <EventsPanel athleteId={athleteId} events={events} today={today} canEdit={canEdit} />

        <Panel title="Fin du suivi">
          <form action={revokeCoachLink} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="link_id" value={link.id} />
            <input type="hidden" name="redirect_to" value="/coach" />
            <p className="text-sm text-muted">Vous perdrez immédiatement l&apos;accès aux données de cet athlète.</p>
            <ConfirmSubmit
              variant="danger"
              size="sm"
              confirmMessage={`Arrêter de suivre ${athlete.display_name} ? Une nouvelle invitation sera nécessaire pour reprendre.`}
            >
              Arrêter le suivi
            </ConfirmSubmit>
          </form>
        </Panel>
      </div>
    </>
  );
}
