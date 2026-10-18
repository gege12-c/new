import { ArrowRight, ChevronRight, Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MiniProfile } from "@/components/calendar/session-chip";
import { StatusGlyph } from "@/components/calendar/status-glyph";
import { PageContainer } from "@/components/layout/page";
import { PlanningLive } from "@/components/realtime/planning-live";
import { PriorityBadge, SPORT_STYLES, SportBadge, SportDot } from "@/components/sport";
import { EmptyState, Notice, SectionSkeleton } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { WorkoutProfile } from "@/components/workout/workout-profile";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getEvents, getMyCoaches, getThresholds } from "@/lib/data/athlete";
import { unattachedActivities, withRealization } from "@/lib/activities/realization";
import { getRealizedInRange } from "@/lib/data/activities";
import { getSessionsInRange, type CalendarSession } from "@/lib/data/planning";
import { calendarHref } from "@/lib/planning/calendar-query";
import { addDays, dateRange, daysBetween, formatDayMonthLong, formatFullDate, formatWeekdayShort, relativeDay, startOfWeek } from "@/lib/planning/dates";
import { sessionStatus, STATUS_LABELS } from "@/lib/planning/status";
import { plannedVolume } from "@/lib/planning/volume";
import { THRESHOLD_DEFS, currentThresholds, formatThresholdValue, toAthleteThresholds } from "@/lib/thresholds";
import { todayIn } from "@/lib/time";
import { computeTotals } from "@/lib/workout/compute";
import { formatDistance, formatDurationShort, formatTimeOfDay } from "@/lib/workout/format";
import { mainBlock } from "@/lib/workout/highlight";
import { SPORT_LABELS } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Aujourd’hui" };

export default function AthleteHomePage({ searchParams }: PageProps<"/athlete">) {
  return (
    <PageContainer>
      <Suspense fallback={<SectionSkeleton />}>
        <AthleteHome searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const sessionHref = (session: CalendarSession) => calendarHref("/athlete/calendar", { view: "day", date: session.scheduled_date, session: session.id });

function TodayCard({ session, thresholds, today }: { session: CalendarSession; thresholds: AthleteThresholds; today: string }) {
  const totals = computeTotals(session.content, thresholds);
  const block = mainBlock(session.content, thresholds);
  const cancelled = session.state === "cancelled";
  const status = sessionStatus(session, today);
  const realized = status === "done" || status === "partial" || status === "missed";
  return (
    <Link href={sessionHref(session)} className="group block rounded-[18px] bg-night p-5 text-night-ink sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <SportBadge sport={session.sport} className="bg-white/10 text-night-ink" />
        <span className="flex items-center gap-3">
          {realized ? (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-night-ink">
              <StatusGlyph status={status} />
              {STATUS_LABELS[status]}
            </span>
          ) : null}
          {session.start_time ? <span className="figure text-[15px] text-night-muted">{formatTimeOfDay(session.start_time)}</span> : null}
        </span>
      </div>
      <h2 className={cn("display mt-4 text-[30px] sm:text-[36px]", cancelled && "line-through opacity-60")}>{session.title}</h2>
      {cancelled ? <p className="mt-1 text-[14px] text-night-muted">Séance annulée</p> : null}
      <WorkoutProfile workout={session.content} thresholds={thresholds} height={92} thresholdLine animate className="mt-5 text-night-ink" />
      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-[12px] font-semibold text-night-muted">Durée</dt>
          <dd className="figure text-[26px] leading-tight">{totals.duration.value ? formatDurationShort(totals.duration.value) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold text-night-muted">Distance</dt>
          <dd className="figure text-[26px] leading-tight">
            {totals.distance.value ? formatDistance(totals.distance.value, session.sport === "swim" ? "swim" : undefined) : "—"}
          </dd>
        </div>
        {block ? (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-[12px] font-semibold text-night-muted">Bloc principal : {block.structure}</dt>
            <dd className="figure text-[22px] leading-tight sm:text-[26px]">{block.target ?? "sans cible"}</dd>
          </div>
        ) : null}
      </dl>
      <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-night-ink/90 group-hover:text-night-ink">
        Voir la prescription
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

async function AthleteHome({ searchParams }: Pick<PageProps<"/athlete">, "searchParams">) {
  const [{ supabase, userId }, profile, params] = await Promise.all([requireSession("/athlete"), getProfile(), searchParams]);
  const today = await todayIn(profile.timezone);
  const monday = startOfWeek(today);
  const weekAgo = addDays(today, -7);
  const from = weekAgo < monday ? weekAgo : monday;
  const [planned, realized, events, coaches, thresholdRows, connection] = await Promise.all([
    getSessionsInRange(supabase, userId, from, addDays(monday, 13)),
    getRealizedInRange(supabase, userId, from, addDays(monday, 13)),
    getEvents(supabase, userId),
    getMyCoaches(supabase, userId),
    getThresholds(supabase, userId),
    supabase.from("external_connections").select("status").eq("provider", "strava").maybeSingle(),
  ]);
  const all = withRealization(planned, realized);
  const sessions = all.filter((s) => s.scheduled_date >= monday);
  // À traiter : la semaine écoulée.
  const recent = all.filter((s) => s.state === "published" && s.scheduled_date >= weekAgo && s.scheduled_date <= today);
  const toValidate = recent.filter((s) => s.realization.proposals.length && !s.realization.attached.length);
  const withoutFeedback = recent.filter((s) => s.scheduled_date < today && sessionStatus(s, today) === "unreconciled");
  const loose = unattachedActivities(realized).filter((a) => a.local_date >= weekAgo && a.local_date <= today);
  const reauth = connection.data?.status === "reauth_required";
  // Base pas encore à jour (migration en attente) : rien à traiter, plutôt que des invitations impossibles.
  const todo = (realized.unavailable ? [] : [
    reauth ? { key: "reauth", tone: "warning" as const, text: "Strava demande une reconnexion : vos activités n’arrivent plus.", action: "Reconnecter", href: "/athlete/profile#connexions" } : null,
    toValidate.length
      ? {
          key: "validate",
          tone: "warning" as const,
          text: toValidate.length > 1 ? `${toValidate.length} activités à valider pour vos séances.` : `Une activité à valider pour « ${toValidate[0].title} ».`,
          action: "Valider",
          href: sessionHref(toValidate[0]),
        }
      : null,
    loose.length
      ? {
          key: "loose",
          tone: "info" as const,
          text: loose.length > 1 ? `${loose.length} activités des 7 derniers jours n’ont pas de séance.` : "Une activité des 7 derniers jours n’a pas de séance.",
          action: "Voir",
          href: calendarHref("/athlete/calendar", { view: "day", date: loose[0].local_date, activity: loose[0].id }),
        }
      : null,
    withoutFeedback.length
      ? {
          key: "feedback",
          tone: "info" as const,
          text: withoutFeedback.length > 1 ? `${withoutFeedback.length} séances passées sans retour à votre coach.` : `« ${withoutFeedback[0].title} » attend votre retour.`,
          action: "Donner mon retour",
          href:
            withoutFeedback.length > 1
              ? calendarHref("/athlete/calendar", { view: "agenda", date: weekAgo, statuses: ["unreconciled"] })
              : sessionHref(withoutFeedback[0]),
        }
      : null,
  ]).filter((item): item is NonNullable<typeof item> => item !== null);
  const thresholds = toAthleteThresholds(currentThresholds(thresholdRows, today));
  const todays = sessions.filter((s) => s.scheduled_date === today);
  const next = sessions.find((s) => s.scheduled_date > today && s.state !== "cancelled");
  const week = dateRange(monday, addDays(monday, 6));
  const weekSessions = sessions.filter((s) => s.scheduled_date <= week[6]);
  const volume = plannedVolume(weekSessions);
  const maxDay = Math.max(1, ...week.map((d) => weekSessions.filter((s) => s.scheduled_date === d && s.state !== "cancelled").reduce((sum, s) => sum + (s.planned_duration_s ?? 0), 0)));
  const nextEvent = events.find((e) => e.event_date >= today);
  const current = currentThresholds(thresholdRows, today);
  const keys = ["bike.ftp_w", "run.threshold_pace_s_per_km", "swim.css_s_per_100m"];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-muted first-letter:uppercase">{formatFullDate(today)}</p>
          <h1 className="display text-[34px] sm:text-[40px]">Aujourd’hui</h1>
        </div>
        <PlanningLive athleteId={userId} self />
      </header>

      {params.joined === "1" ? <Notice tone="success">Invitation acceptée : votre coach peut désormais suivre et planifier votre entraînement.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          {todays.length ? (
            todays.map((session) => <TodayCard key={session.id} session={session} thresholds={thresholds} today={today} />)
          ) : (
            <div className="rounded-[18px] border border-line bg-surface p-6">
              <p className="display text-[30px]">Repos</p>
              <p className="mt-2 text-[15px] text-muted">Aucune séance prévue aujourd’hui. Profitez-en pour récupérer.</p>
            </div>
          )}

          {next ? (
            <Link
              href={sessionHref(next)}
              className="flex items-center gap-4 rounded-[14px] border border-line bg-surface p-4 transition-colors hover:border-line-strong"
            >
              <span className={cn("w-1 self-stretch rounded-full", SPORT_STYLES[next.sport].solid)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-muted first-letter:uppercase">
                  Ensuite, {relativeDay(next.scheduled_date, today) ?? formatFullDate(next.scheduled_date)}
                  {next.start_time ? ` à ${formatTimeOfDay(next.start_time)}` : ""}
                </p>
                <p className="heading truncate text-[17px]">{next.title}</p>
                <MiniProfile session={next} thresholds={thresholds} height={18} className="mt-2 max-w-sm" />
              </div>
              <span className="figure shrink-0 text-[18px]">{next.planned_duration_s ? formatDurationShort(next.planned_duration_s) : "—"}</span>
            </Link>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {todo.length ? (
            <Panel title="À traiter">
              <ul className="-my-2 divide-y divide-line">
                {todo.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="group flex items-center gap-3 py-2.5">
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", item.tone === "warning" ? "bg-warning" : "bg-line-strong")} />
                      <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink">{item.text}</span>
                      <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-ink-soft group-hover:text-ink">
                        {item.action}
                        <ChevronRight className="size-4" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel
            title="Cette semaine"
            actions={
              <Link href={calendarHref("/athlete/calendar", { view: "week", date: today })} className="text-[13px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
                Calendrier
              </Link>
            }
          >
            <div className="grid grid-cols-7 gap-1.5" role="list" aria-label="Jours de la semaine">
              {week.map((day) => {
                const daySessions = weekSessions.filter((s) => s.scheduled_date === day && s.state !== "cancelled");
                return (
                  <Link
                    key={day}
                    role="listitem"
                    href={calendarHref("/athlete/calendar", { view: "day", date: day })}
                    aria-label={`${formatFullDate(day)} : ${daySessions.length ? daySessions.map((s) => s.title).join(", ") : "repos"}`}
                    className={cn("flex flex-col items-center gap-1.5 rounded-[10px] py-2", day === today ? "bg-surface-3" : "hover:bg-surface-2")}
                  >
                    <span className="text-[11px] font-semibold uppercase text-muted">{formatWeekdayShort(day).slice(0, 1)}</span>
                    <span className={cn("figure text-[14px]", day === today ? "text-ink" : "text-ink-soft")}>{Number(day.slice(8))}</span>
                    <span className="flex h-14 w-3 flex-col-reverse overflow-hidden rounded-full bg-surface-2" aria-hidden>
                      {daySessions.map((s) => (
                        <span key={s.id} className={SPORT_STYLES[s.sport].solid} style={{ height: `${((s.planned_duration_s ?? 0) / maxDay) * 100}%` }} />
                      ))}
                    </span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[13px] font-semibold text-muted">Volume prévu</span>
              <span className="figure text-[22px]">{volume.totalSeconds ? formatDurationShort(volume.totalSeconds) : "—"}</span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {volume.bySport.map((v) => (
                <li key={v.sport} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="flex items-center gap-2">
                    <SportDot sport={v.sport} />
                    {SPORT_LABELS[v.sport]}
                  </span>
                  <span className="figure text-ink-soft">
                    {v.seconds ? formatDurationShort(v.seconds) : "—"}
                    {v.meters ? <span className="ml-2 text-muted">{formatDistance(v.meters, v.sport === "swim" ? "swim" : undefined)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {volume.unknownDuration ? (
              <p className="mt-2 text-[12px] text-muted">
                {volume.unknownDuration} séance{volume.unknownDuration > 1 ? "s" : ""} sans durée calculable, non comptée{volume.unknownDuration > 1 ? "s" : ""}.
              </p>
            ) : null}
          </Panel>

          <Panel title="Prochaine compétition">
            {nextEvent ? (
              <div className="flex items-center gap-4">
                <Flag className="size-5 shrink-0 text-ink-soft" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-semibold">{nextEvent.name}</span>
                    <PriorityBadge priority={nextEvent.priority} />
                  </p>
                  <p className="text-[13px] text-muted">{formatDayMonthLong(nextEvent.event_date)}</p>
                </div>
                <p className="figure shrink-0 text-[28px] leading-none">J−{daysBetween(today, nextEvent.event_date)}</p>
              </div>
            ) : (
              <EmptyState title="Pas de compétition prévue">
                <Link href="/athlete/profile" className="font-semibold text-ink underline decoration-line-strong underline-offset-4">
                  Ajouter une compétition
                </Link>
              </EmptyState>
            )}
          </Panel>

          <Panel
            title="Mes seuils"
            actions={
              <Link href="/athlete/profile" className="text-[13px] font-semibold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
                Mettre à jour
              </Link>
            }
          >
            <dl className="grid grid-cols-3 gap-3">
              {keys.map((key) => {
                const def = THRESHOLD_DEFS.find((d) => d.key === key)!;
                const row = current.get(key);
                return (
                  <div key={key}>
                    <dt className="text-[12px] font-semibold text-muted">{def.label}</dt>
                    <dd className={cn("figure text-[17px]", row ? "text-ink" : "text-muted")}>{row ? formatThresholdValue(def, row.value) : "—"}</dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 text-[13px] text-muted">
              {coaches.length ? `Coach : ${coaches.map((c) => c.coach?.display_name ?? "Coach").join(", ")}.` : "Pas encore de coach."}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
