import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { revokeInvitation } from "@/app/(app)/actions";
import { InvitationForm } from "@/components/coach/invitation-form";
import { PageContainer } from "@/components/layout/page";
import { PriorityBadge, SPORT_STYLES, SportDot } from "@/components/sport";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getAthletesOverview, getCoachDashboard, getCoachedAthletes, getPendingInvitations } from "@/lib/data/coach";
import { addDays, daysBetween, formatDayMonth, formatWeekRange, formatWeekdayShort, relativeDay, startOfWeek } from "@/lib/planning/dates";
import { plannedVolume } from "@/lib/planning/volume";
import { todayIn } from "@/lib/time";
import { formatDurationShort } from "@/lib/workout/format";
import type { SessionSport } from "@/lib/workout/schema";
import { cn, formatLocalDate, initials, localDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Athlètes" };

export default function CoachPage() {
  return (
    <PageContainer wide>
      <Suspense fallback={<SectionSkeleton />}>
        <CoachContent />
      </Suspense>
    </PageContainer>
  );
}

const relativeTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

async function CoachContent() {
  const [{ supabase, userId }, profile] = await Promise.all([requireSession("/coach"), getProfile()]);

  if (!profile.is_coach) {
    return (
      <>
        <PageHeader title="Athlètes" />
        <EmptyState title="L’espace coach n’est pas activé" action={<ButtonLink href="/settings">Activer le mode coach</ButtonLink>}>
          Activez-le dans vos réglages pour inviter des athlètes et planifier leurs séances.
        </EmptyState>
      </>
    );
  }

  const today = await todayIn(profile.timezone);
  const monday = startOfWeek(today);
  const [links, pending] = await Promise.all([getCoachedAthletes(supabase, userId), getPendingInvitations(supabase, userId)]);
  const ids = links.map((l) => l.athlete_id);
  const [overview, dashboard] = await Promise.all([
    getAthletesOverview(supabase, ids, today),
    getCoachDashboard(supabase, ids, monday, addDays(monday, 13)),
  ]);
  const drafts = dashboard.sessions.filter((s) => s.state === "draft").length;

  return (
    <>
      <PageHeader
        title="Athlètes"
        description={
          links.length
            ? `Semaine du ${formatWeekRange(monday)} : ${links.length} athlète${links.length > 1 ? "s" : ""} suivi${links.length > 1 ? "s" : ""}${drafts ? `, ${drafts} brouillon${drafts > 1 ? "s" : ""} à publier` : ""}.`
            : "Invitez vos athlètes : ils acceptent depuis leur compte, et vous planifiez leurs séances."
        }
        actions={
          <ButtonLink href="#inviter" variant="secondary">
            Inviter un athlète
          </ButtonLink>
        }
      />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Athlètes suivis" className="min-w-0">
          {links.length === 0 ? (
            <EmptyState title="Aucun athlète pour l’instant">Créez un lien d’invitation et envoyez-le à votre athlète.</EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {links.map((link) => {
                const name = link.athlete?.display_name ?? "Athlète";
                const athleteProfile = overview.profiles.find((p) => p.user_id === link.athlete_id);
                const nextEvent = overview.events.find((e) => e.athlete_id === link.athlete_id);
                const sessions = dashboard.sessions.filter((s) => s.athlete_id === link.athlete_id);
                const thisWeek = sessions.filter((s) => s.scheduled_date <= addDays(monday, 6));
                const volume = plannedVolume(thisWeek);
                const total = Math.max(1, volume.totalSeconds);
                const upcoming = sessions.filter((s) => s.scheduled_date >= today && s.state !== "cancelled").slice(0, 3);
                const draftCount = sessions.filter((s) => s.state === "draft").length;
                const lastComment = dashboard.comments.find((c) => c.athlete_id === link.athlete_id && c.visibility === "shared");
                const target = athleteProfile?.weekly_hours_target ? Number(athleteProfile.weekly_hours_target) * 3600 : null;
                return (
                  <li key={link.id}>
                    <Link
                      href={`/coach/athletes/${link.athlete_id}`}
                      className="grid gap-x-6 gap-y-4 px-4 py-4 transition-colors hover:bg-surface-2/60 sm:px-5 lg:grid-cols-[minmax(200px,1.1fr)_minmax(180px,1fr)_minmax(220px,1.3fr)_minmax(180px,1fr)] lg:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden className="figure flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-[14px] text-canvas">
                          {initials(name)}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2">
                            <span className="heading truncate text-[16px]">{name}</span>
                            {link.can_edit_plan ? null : (
                              <span className="shrink-0 rounded-[6px] bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-muted">Lecture seule</span>
                            )}
                          </p>
                          <p className="truncate text-[13px] text-muted">{athleteProfile?.main_goal ?? "Objectif non renseigné"}</p>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="flex items-baseline justify-between gap-2 text-[12px] font-semibold text-muted">
                          Cette semaine
                          {draftCount ? <span className="font-semibold text-warning">{draftCount} brouillon{draftCount > 1 ? "s" : ""}</span> : null}
                        </p>
                        <p className="mt-0.5 flex items-baseline gap-2">
                          <span className="figure text-[20px] leading-none">{volume.totalSeconds ? formatDurationShort(volume.totalSeconds) : "—"}</span>
                          {target ? <span className="figure text-[12px] text-muted">/ {formatDurationShort(target)} visées</span> : null}
                        </p>
                        <span className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                          {volume.bySport.map((v) => (
                            <span key={v.sport} className={cn("h-full", SPORT_STYLES[v.sport].solid)} style={{ width: `${(v.seconds / Math.max(total, target ?? 0)) * 100}%` }} />
                          ))}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-muted">À venir</p>
                        {upcoming.length ? (
                          <ul className="mt-1 space-y-1">
                            {upcoming.map((session) => (
                              <li key={session.id} className="flex items-center gap-2 text-[13px]">
                                <SportDot sport={session.sport as SessionSport} />
                                <span className="w-[4.5rem] shrink-0 text-muted first-letter:uppercase">
                                  {relativeDay(session.scheduled_date, today) ?? `${formatWeekdayShort(session.scheduled_date)} ${formatDayMonth(session.scheduled_date)}`}
                                </span>
                                <span className={cn("truncate", session.state === "draft" ? "text-muted italic" : "text-ink")}>{session.title}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[13px] text-muted">Rien de planifié sur 14 jours.</p>
                        )}
                      </div>

                      <div className="min-w-0 space-y-2">
                        {nextEvent ? (
                          <p className="flex min-w-0 items-center gap-2 text-[13px]">
                            <PriorityBadge priority={nextEvent.priority} />
                            <span className="truncate">{nextEvent.name}</span>
                            <span className="figure shrink-0 text-muted">J−{daysBetween(today, nextEvent.event_date)}</span>
                          </p>
                        ) : (
                          <p className="text-[13px] text-muted">Pas de compétition prévue</p>
                        )}
                        {lastComment ? (
                          <div className="text-[13px] leading-snug">
                            <p className="flex gap-2">
                              <span className="font-semibold text-ink">{lastComment.author_name.split(" ")[0]}</span>
                              <span className="text-muted">{relativeTime(lastComment.created_at, profile.timezone)}</span>
                            </p>
                            <p className="line-clamp-1 text-ink-soft">{lastComment.body}</p>
                          </div>
                        ) : (
                          <p className="text-[13px] text-muted">Aucun échange récent</p>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[12px] text-muted">
            Charge d’entraînement, dernières activités et état des synchronisations apparaîtront ici avec l’import Strava.
          </p>
        </section>

        <aside className="space-y-6">
          <Panel title="Inviter un athlète" description="L’athlète ouvre le lien, crée son compte ou se connecte, puis accepte." className="scroll-mt-6" bodyClassName="pt-4">
            <div id="inviter">
              <InvitationForm coachName={profile.display_name} />
            </div>
          </Panel>

          <Panel title="Invitations en attente">
            {pending.length === 0 ? (
              <p className="text-[14px] text-muted">Aucune invitation en attente.</p>
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{invitation.email ?? "Lien sans adresse imposée"}</p>
                      <p className="text-[13px] text-muted">Expire le {formatLocalDate(localDate(profile.timezone, new Date(invitation.expires_at)))}</p>
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
        </aside>
      </div>
    </>
  );
}
