import type { Metadata } from "next";
import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { StatusGlyph } from "@/components/calendar/status-glyph";
import { PageContainer } from "@/components/layout/page";
import { SportDot } from "@/components/sport";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { withoutStrava, withRealization } from "@/lib/activities/realization";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { teamWeek } from "@/lib/coach/team-week";
import { getRealizedInRange } from "@/lib/data/activities";
import { getCoachDashboard, getCoachedAthletes } from "@/lib/data/coach";
import { getUpcomingUnavailability } from "@/lib/data/notes";
import { addDays, formatDayMonth, formatWeekRange, formatWeekdayShort, isISODate, startOfWeek } from "@/lib/planning/dates";
import { STATUS_LABELS } from "@/lib/planning/status";
import { todayIn } from "@/lib/time";
import { formatDurationShort } from "@/lib/workout/format";
import { SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Semaine de mes athlètes" };

export default function CoachWeekPage({ searchParams }: PageProps<"/coach/week">) {
  return (
    <PageContainer wide>
      <Suspense fallback={<SectionSkeleton />}>
        <TeamWeek searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const SHOWN_STATUSES = new Set(["done", "partial", "missed", "unreconciled"]);

async function TeamWeek({ searchParams }: Pick<PageProps<"/coach/week">, "searchParams">) {
  const [{ supabase, userId }, profile, query] = await Promise.all([requireSession("/coach/week"), getProfile(), searchParams]);
  if (!profile.is_coach) {
    return (
      <>
        <PageHeader title="Semaine de mes athlètes" />
        <EmptyState title="L’espace coach n’est pas activé" action={<ButtonLink href="/settings">Activer le mode coach</ButtonLink>}>
          Activez-le dans vos réglages pour inviter des athlètes et planifier leurs séances.
        </EmptyState>
      </>
    );
  }
  const today = await todayIn(profile.timezone);
  const asked = typeof query.week === "string" && isISODate(query.week) ? query.week : today;
  const monday = startOfWeek(asked);
  const sunday = addDays(monday, 6);
  const links = await getCoachedAthletes(supabase, userId);
  const ids = links.map((l) => l.athlete_id);
  const [dashboard, realized, notes] = await Promise.all([
    getCoachDashboard(supabase, ids, monday, sunday),
    getRealizedInRange(supabase, ids, monday, sunday),
    getUpcomingUnavailability(supabase, ids, monday, sunday),
  ]);
  // Le réalisé ne tient jamais compte de Strava (aucune statistique tirée de Strava).
  const visible = withoutStrava(realized);
  const rows = teamWeek({
    athletes: links.map((l) => ({ id: l.athlete_id, name: l.athlete?.display_name ?? "Athlète" })),
    sessions: withRealization(dashboard.sessions, visible),
    activities: visible.activities,
    notes,
    monday,
    today,
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const week = (offset: number) => `/coach/week?week=${addDays(monday, offset * 7)}`;

  return (
    <>
      <PageHeader
        title="Semaine de mes athlètes"
        description={`Semaine du ${formatWeekRange(monday)} : chaque séance, son état, et ce qui a été fait hors programme.`}
        actions={
          <nav aria-label="Changer de semaine" className="flex items-center gap-1.5">
            <ButtonLink href={week(-1)} variant="secondary" size="sm" aria-label="Semaine précédente">
              <ChevronLeft className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/coach/week" variant="secondary" size="sm">
              Cette semaine
            </ButtonLink>
            <ButtonLink href={week(1)} variant="secondary" size="sm" aria-label="Semaine suivante">
              <ChevronRight className="size-4" aria-hidden />
            </ButtonLink>
          </nav>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="Aucun athlète pour l’instant" action={<ButtonLink href="/coach#inviter">Inviter un athlète</ButtonLink>}>
          Invitez vos athlètes depuis votre tableau de bord : leur semaine apparaîtra ici.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
          <table className="w-full min-w-[1040px] table-fixed border-collapse text-left">
            <caption className="sr-only">Séances de vos athlètes, semaine du {formatWeekRange(monday)}</caption>
            <colgroup>
              <col className="w-[160px]" />
              {days.map((day) => (
                <col key={day} />
              ))}
              <col className="w-[120px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-[12px] text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  Athlète
                </th>
                {days.map((day) => (
                  <th key={day} scope="col" className={cn("px-2 py-2 font-medium", day === today && "text-ink")}>
                    <span className="capitalize">{formatWeekdayShort(day)}</span> <span className="figure">{formatDayMonth(day)}</span>
                    {day === today ? <span className="sr-only"> (aujourd’hui)</span> : null}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium">
                  Semaine
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.athleteId} className="align-top">
                  <th scope="row" className="px-3 py-2.5">
                    <Link href={`/coach/athletes/${row.athleteId}?view=week&date=${monday}`} className="heading text-[14.5px] underline-offset-4 hover:underline">
                      {row.name}
                    </Link>
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.date} className={cn("px-1.5 py-2", cell.date === today && "bg-surface-2/60", cell.away && "bg-warning-soft/40")}>
                      <div className="space-y-1">
                        {cell.away ? (
                          <p className="flex items-center gap-1 text-[11.5px] font-semibold text-warning" title={cell.away}>
                            <CalendarOff className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{cell.away}</span>
                          </p>
                        ) : null}
                        {cell.sessions.map((s) => (
                          <Link
                            key={s.id}
                            href={`/coach/athletes/${row.athleteId}?view=week&date=${cell.date}&session=${s.id}`}
                            className={cn(
                              "flex items-center gap-1.5 rounded-[8px] border px-1.5 py-1 text-[12.5px] leading-tight transition-colors hover:bg-surface-2",
                              s.draft ? "border-dashed border-line-strong italic text-muted" : "border-line text-ink",
                            )}
                            title={`${s.title}, ${STATUS_LABELS[s.status].toLowerCase()}`}
                          >
                            <SportDot sport={s.sport as SessionSport} />
                            <span className="min-w-0 flex-1 truncate">{s.title}</span>
                            {SHOWN_STATUSES.has(s.status) ? <StatusGlyph status={s.status} /> : null}
                            <span className="sr-only">, {STATUS_LABELS[s.status].toLowerCase()}</span>
                          </Link>
                        ))}
                        {cell.extra.map((a) => (
                          <Link
                            key={a.id}
                            href={`/coach/athletes/${row.athleteId}?view=week&date=${cell.date}&activity=${a.id}`}
                            className="flex items-center gap-1.5 rounded-[8px] bg-surface-2 px-1.5 py-1 text-[12px] leading-tight text-ink-soft hover:bg-surface-3"
                          >
                            <SportDot sport={a.sport as SessionSport} />
                            <span className="min-w-0 flex-1 truncate">
                              {SPORT_LABELS[a.sport as SessionSport] ?? "Activité"} hors programme
                            </span>
                            {a.durationS ? <span className="figure shrink-0 text-muted">{formatDurationShort(a.durationS)}</span> : null}
                          </Link>
                        ))}
                      </div>
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-[12.5px]">
                    <p className="figure text-[15px] font-semibold text-ink">{row.plannedS ? formatDurationShort(row.plannedS) : "—"}</p>
                    <p className="text-muted">prévues</p>
                    {!realized.unavailable ? <p className="figure mt-1 text-ink-soft">{row.realizedS ? `${formatDurationShort(row.realizedS)} faites` : "rien de fait"}</p> : null}
                    {row.missed ? <p className="mt-1 font-semibold text-warning">{row.missed} manquée{row.missed > 1 ? "s" : ""}</p> : null}
                    {row.drafts ? <p className="mt-1 font-semibold text-warning">{row.drafts} brouillon{row.drafts > 1 ? "s" : ""}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 max-w-3xl text-[12px] leading-snug text-muted">
        Faites : activités de la montre (par intervals.icu) et fichiers FIT des athlètes qui vous autorisent à voir leurs activités. Les activités Strava ne sont pas comptées (règles de Strava).
      </p>
    </>
  );
}
