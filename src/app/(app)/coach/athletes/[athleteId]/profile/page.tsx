import type { Metadata } from "next";
import { Suspense } from "react";
import { revokeCoachLink } from "@/app/(app)/actions";
import { EventsPanel } from "@/components/athlete/events-panel";
import { ThresholdsPanel } from "@/components/athlete/thresholds-panel";
import { AthleteHeader } from "@/components/coach/athlete-header";
import { PageContainer } from "@/components/layout/page";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { Notice, SectionSkeleton } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { loadCoachedAthlete } from "@/lib/coach/access";
import { EXPERIENCE_LABELS, getEvents, getThresholds } from "@/lib/data/athlete";

export const metadata: Metadata = { title: "Profil de l’athlète" };

export default function CoachAthleteProfilePage({ params }: PageProps<"/coach/athletes/[athleteId]/profile">) {
  return (
    <PageContainer wide>
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteProfile params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function AthleteProfile({ params }: Pick<PageProps<"/coach/athletes/[athleteId]/profile">, "params">) {
  const { athleteId } = await params;
  const ctx = await loadCoachedAthlete(athleteId, `/coach/athletes/${athleteId}/profile`);
  const [thresholds, events] = await Promise.all([getThresholds(ctx.supabase, athleteId), getEvents(ctx.supabase, athleteId)]);
  const { athlete, athleteProfile, canPlan, today } = ctx;

  return (
    <>
      <AthleteHeader
        athleteId={athleteId}
        name={athlete.display_name}
        goal={athleteProfile?.main_goal ?? null}
        thresholds={thresholds}
        nextEvent={events.find((e) => e.event_date >= today) ?? null}
        today={today}
        active="profile"
        readOnly={!canPlan}
      />
      {athlete.timezone !== ctx.coach.timezone ? (
        <Notice className="mb-6">Fuseau horaire de l’athlète : {athlete.timezone}. Les dates sont affichées dans son fuseau.</Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Profil">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-[13px] text-muted">Niveau</dt>
                <dd className="font-medium">{athleteProfile?.experience_level ? EXPERIENCE_LABELS[athleteProfile.experience_level] : "Non précisé"}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted">Volume visé</dt>
                <dd className="figure font-medium">
                  {athleteProfile?.weekly_hours_target ? `${athleteProfile.weekly_hours_target} h par semaine` : "Non précisé"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[13px] text-muted">Informations de l’athlète</dt>
                <dd className="whitespace-pre-line">{athleteProfile?.notes || "Aucune"}</dd>
              </div>
            </dl>
          </Panel>
          <EventsPanel athleteId={athleteId} events={events} today={today} canEdit={canPlan} />
        </div>
        <div className="space-y-6">
          <ThresholdsPanel athleteId={athleteId} rows={thresholds} today={today} canEdit={canPlan} />
          <Panel title="Fin du suivi">
            <form action={revokeCoachLink} className="flex flex-wrap items-center justify-between gap-3">
              <input type="hidden" name="link_id" value={ctx.link.id} />
              <input type="hidden" name="redirect_to" value="/coach" />
              <p className="text-[14px] text-muted">Vous perdrez immédiatement l’accès aux données de cet athlète.</p>
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
      </div>
    </>
  );
}
