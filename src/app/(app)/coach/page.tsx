import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { revokeInvitation } from "@/app/(app)/actions";
import { InvitationForm } from "@/components/coach/invitation-form";
import { PriorityBadge } from "@/components/sport";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getAthletesOverview, getCoachedAthletes, getPendingInvitations } from "@/lib/data/coach";
import { currentThresholds, formatThresholdValue, thresholdDef } from "@/lib/thresholds";
import { daysBetween, formatLocalDate, localDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Mes athlètes" };

export default function CoachPage() {
  return (
    <>
      <PageHeader title="Mes athlètes" description="Les athlètes qui vous ont donné accès, et les invitations en cours." />
      <Suspense fallback={<SectionSkeleton />}>
        <CoachContent />
      </Suspense>
    </>
  );
}

const SNAPSHOT = [
  { def: thresholdDef("bike", "ftp_w")!, short: "FTP" },
  { def: thresholdDef("run", "threshold_pace_s_per_km")!, short: "Allure seuil" },
  { def: thresholdDef("swim", "css_s_per_100m")!, short: "CSS" },
];

async function CoachContent() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/coach"), getProfile()]);

  if (!profile.is_coach) {
    return (
      <EmptyState
        title="L'espace coach n'est pas activé"
        action={<ButtonLink href="/settings">Activer le mode coach</ButtonLink>}
      >
        Activez-le dans vos réglages pour inviter des athlètes et planifier leurs séances.
      </EmptyState>
    );
  }

  const today = localDate(profile.timezone);
  const [links, pending] = await Promise.all([getCoachedAthletes(supabase, userId), getPendingInvitations(supabase, userId)]);
  const overview = await getAthletesOverview(
    supabase,
    links.map((l) => l.athlete_id),
    today,
  );

  return (
    <div className="space-y-6">
      <Panel title="Athlètes suivis" description={links.length ? `${links.length} athlète(s)` : undefined}>
        {links.length === 0 ? (
          <EmptyState title="Aucun athlète pour l'instant">Créez un lien d&apos;invitation ci-dessous et envoyez-le à votre athlète.</EmptyState>
        ) : (
          <ul className="-my-3 divide-y divide-line">
            {links.map((link) => {
              const athleteProfile = overview.profiles.find((p) => p.user_id === link.athlete_id);
              const nextEvent = overview.events.find((e) => e.athlete_id === link.athlete_id);
              const current = currentThresholds(
                overview.thresholds.filter((t) => t.athlete_id === link.athlete_id),
                today,
              );
              return (
                <li key={link.id}>
                  <Link
                    href={`/coach/athletes/${link.athlete_id}`}
                    className="-mx-2 grid gap-2 rounded-md px-2 py-3 hover:bg-surface-2 md:grid-cols-[1.2fr_1.2fr_1fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{link.athlete?.display_name ?? "Athlète"}</span>
                        {link.can_edit_plan ? null : (
                          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-normal text-muted">Lecture seule</span>
                        )}
                      </p>
                      <p className="truncate text-sm text-muted">{athleteProfile?.main_goal ?? "Objectif non renseigné"}</p>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      {nextEvent ? (
                        <>
                          <PriorityBadge priority={nextEvent.priority} />
                          <span className="truncate">{nextEvent.name}</span>
                          <span className="tabular shrink-0 text-muted">J-{daysBetween(today, nextEvent.event_date)}</span>
                        </>
                      ) : (
                        <span className="text-muted">Pas de compétition prévue</span>
                      )}
                    </div>
                    <p className="tabular flex flex-wrap gap-x-4 text-sm text-muted">
                      {SNAPSHOT.map(({ def, short }) => {
                        const row = current.get(def.key);
                        return (
                          <span key={def.key}>
                            {short} <span className="text-ink">{row ? formatThresholdValue(def, row.value) : "non renseigné"}</span>
                          </span>
                        );
                      })}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Inviter un athlète" description="L'athlète ouvre le lien, crée son compte ou se connecte, puis accepte.">
        <InvitationForm coachName={profile.display_name} />
      </Panel>

      <Panel title="Invitations en attente">
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Aucune invitation en attente.</p>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px]">{invitation.email ?? "Lien sans adresse imposée"}</p>
                  <p className="text-sm text-muted">
                    Expire le {formatLocalDate(localDate(profile.timezone, new Date(invitation.expires_at)))}
                  </p>
                </div>
                <form action={revokeInvitation}>
                  <input type="hidden" name="id" value={invitation.id} />
                  <ConfirmSubmit size="sm" variant="ghost" confirmMessage="Annuler cette invitation ? Le lien ne fonctionnera plus.">
                    Annuler
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
