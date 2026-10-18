"use client";

import { ChevronLeft, ChevronRight, CopyPlus, Flag, LibraryBig, Plus, X } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { copyWeek, duplicateSession, moveSession, scheduleTemplate } from "@/app/(app)/planning-actions";
import { SPORT_ICONS, SPORT_STYLES, SportDot } from "@/components/sport";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { controlClasses } from "@/components/ui/field";
import type { CalendarEvent, CalendarSession, TemplateSummary } from "@/lib/data/planning-types";
import { calendarHref, type CalendarQuery } from "@/lib/planning/calendar-query";
import {
  addDays,
  CALENDAR_VIEWS,
  dateRange,
  formatDayMonth,
  formatFullDate,
  formatWeekday,
  formatWeekdayShort,
  formatWeekRange,
  isoWeekNumber,
  monthWeeks,
  relativeDay,
  shiftAnchor,
  startOfWeek,
  VIEW_LABELS,
  viewRange,
  viewTitle,
  type ISODate,
} from "@/lib/planning/dates";
import { sessionStatus, STATUS_LABELS, type SessionStatus } from "@/lib/planning/status";
import { plannedVolume } from "@/lib/planning/volume";
import { formatDurationShort as formatDuration } from "@/lib/workout/format";
import { SPORT_LABELS, type SessionSport } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { cn } from "@/lib/utils";
import { SessionChip } from "./session-chip";

type Optimistic = { type: "move"; id: string; date: ISODate } | { type: "copy"; id: string; date: ISODate } | { type: "template"; template: TemplateSummary; date: ISODate };

const SESSION_MIME = "application/x-tricoach-session";
const TEMPLATE_MIME = "application/x-tricoach-template";

export function PlanningCalendar({
  mode,
  athleteId,
  basePath,
  query,
  today,
  sessions,
  events,
  thresholds,
  canMove,
  canCreate,
  newSessionPath,
  templates = [],
  toolbarExtra,
}: {
  mode: "coach" | "athlete";
  athleteId: string;
  basePath: string;
  query: CalendarQuery;
  today: ISODate;
  sessions: CalendarSession[];
  events: CalendarEvent[];
  thresholds?: AthleteThresholds;
  canMove: boolean;
  canCreate: boolean;
  newSessionPath?: string;
  templates?: TemplateSummary[];
  toolbarExtra?: ReactNode;
}) {
  const [optimistic, apply] = useOptimistic(sessions, (state: CalendarSession[], action: Optimistic) => {
    if (action.type === "move") return state.map((s) => (s.id === action.id ? { ...s, scheduled_date: action.date } : s));
    if (action.type === "copy") {
      const source = state.find((s) => s.id === action.id);
      return source ? [...state, { ...source, id: `copie-${source.id}-${action.date}`, scheduled_date: action.date, pending: false }] : state;
    }
    const t = action.template;
    return [
      ...state,
      {
        id: `modele-${t.id}-${action.date}`,
        athlete_id: athleteId,
        scheduled_date: action.date,
        start_time: null,
        sport: t.sport,
        title: t.name,
        objective: t.objective,
        planned_duration_s: t.planned_duration_s,
        planned_distance_m: null,
        state: "draft" as const,
        version: 1,
        created_by: null,
        content: t.content,
        pending: false,
      },
    ];
  });
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ISODate | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const visible = optimistic.filter((s) => {
    if (query.sports?.length && !query.sports.includes(s.sport)) return false;
    if (query.statuses?.length && !query.statuses.includes(sessionStatus(s, today))) return false;
    return true;
  });
  const byDate = new Map<ISODate, CalendarSession[]>();
  for (const session of visible) byDate.set(session.scheduled_date, [...(byDate.get(session.scheduled_date) ?? []), session]);
  const eventsByDate = new Map<ISODate, CalendarEvent[]>();
  for (const event of events) eventsByDate.set(event.event_date, [...(eventsByDate.get(event.event_date) ?? []), event]);

  const sessionHref = (session: CalendarSession) => calendarHref(basePath, query, { session: session.id });
  const newHref = (date: ISODate) => (newSessionPath ? `${newSessionPath}?date=${date}` : null);

  const drop = (event: DragEvent, date: ISODate) => {
    event.preventDefault();
    setOver(null);
    setDragging(null);
    const sessionId = event.dataTransfer.getData(SESSION_MIME);
    const templateId = event.dataTransfer.getData(TEMPLATE_MIME);
    if (templateId && canCreate) {
      const template = templates.find((t) => t.id === templateId);
      if (!template) return;
      startTransition(async () => {
        apply({ type: "template", template, date });
        const result = await scheduleTemplate(athleteId, templateId, date);
        setMessage(
          result.status === "ok"
            ? { tone: "success", text: `« ${template.name} » ajoutée en brouillon le ${formatDayMonth(date)}.` }
            : { tone: "error", text: result.message },
        );
      });
      return;
    }
    if (!sessionId || !canMove) return;
    const session = optimistic.find((s) => s.id === sessionId);
    if (!session) return;
    const copy = (event.altKey || event.ctrlKey || event.metaKey) && canCreate;
    if (!copy && session.scheduled_date === date) return;
    startTransition(async () => {
      apply(copy ? { type: "copy", id: sessionId, date } : { type: "move", id: sessionId, date });
      const result = copy ? await duplicateSession(sessionId, date) : await moveSession(sessionId, session.scheduled_date, date);
      if (result.status === "ok") {
        setMessage({ tone: "success", text: `${copy ? "Copiée" : "Déplacée"} au ${formatFullDate(date)}.` });
      } else if (result.status === "conflict") {
        setMessage({ tone: "error", text: "Cette séance a changé entre-temps : rien n’a été déplacé. Réessayez." });
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  };

  const dropTarget = (date: ISODate) =>
    canMove || canCreate
      ? {
          onDragOver: (event: DragEvent) => {
            const types = event.dataTransfer.types;
            if (!types.includes(SESSION_MIME) && !types.includes(TEMPLATE_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = types.includes(TEMPLATE_MIME) || event.altKey || event.ctrlKey || event.metaKey ? "copy" : "move";
            if (over !== date) setOver(date);
          },
          onDragLeave: () => setOver((current) => (current === date ? null : current)),
          onDrop: (event: DragEvent) => drop(event, date),
        }
      : {};

  const chipDrag = canMove
    ? {
        draggable: true,
        onDragStart: (event: DragEvent, session: CalendarSession) => {
          event.dataTransfer.setData(SESSION_MIME, session.id);
          event.dataTransfer.effectAllowed = "copyMove";
          setDragging(session.id);
        },
        onDragEnd: () => {
          setDragging(null);
          setOver(null);
        },
      }
    : {};

  const shared = { basePath, byDate, eventsByDate, today, query, thresholds, sessionHref, newHref, dropTarget, chipDrag, over, canCreate };

  return (
    <div className={cn(dragging && "select-none")}>
      <Toolbar
        basePath={basePath}
        query={query}
        today={today}
        mode={mode}
        canCreate={canCreate}
        newHref={newHref}
        onCopyWeek={() => setCopyOpen(true)}
        onPalette={templates.length ? () => setPaletteOpen((v) => !v) : undefined}
        paletteOpen={paletteOpen}
        extra={toolbarExtra}
      />

      {message ? (
        <div className="mb-3 flex items-start gap-2">
          <Notice tone={message.tone} className="flex-1">
            {message.text}
          </Notice>
          <Button variant="ghost" size="sm" onClick={() => setMessage(null)}>
            Fermer
          </Button>
        </div>
      ) : null}

      <div className={cn("grid gap-4", paletteOpen && "xl:grid-cols-[minmax(0,1fr)_260px]")}>
        <div className="min-w-0">
          {query.view === "month" ? <MonthView {...shared} /> : null}
          {query.view === "week" ? <WeekView {...shared} /> : null}
          {query.view === "day" ? <DayView {...shared} /> : null}
          {query.view === "agenda" ? <AgendaView {...shared} /> : null}
          {canMove ? (
            <p className="mt-3 hidden text-[12px] text-muted lg:block">
              Glissez une séance pour la déplacer{canCreate ? " ; maintenez Alt (⌥) en la déposant pour la copier" : ""}.
            </p>
          ) : null}
        </div>
        {paletteOpen ? <TemplatePalette templates={templates} onClose={() => setPaletteOpen(false)} /> : null}
      </div>

      {mode === "coach" ? (
        <CopyWeekDialog
          open={copyOpen}
          onClose={() => setCopyOpen(false)}
          athleteId={athleteId}
          sourceMonday={startOfWeek(query.date)}
          onDone={(text, tone) => setMessage({ text, tone })}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barre d’outils
// ---------------------------------------------------------------------------

function Toolbar({
  basePath,
  query,
  today,
  mode,
  canCreate,
  newHref,
  onCopyWeek,
  onPalette,
  paletteOpen,
  extra,
}: {
  basePath: string;
  query: CalendarQuery;
  today: ISODate;
  mode: "coach" | "athlete";
  canCreate: boolean;
  newHref: (date: ISODate) => string | null;
  onCopyWeek: () => void;
  onPalette?: () => void;
  paletteOpen: boolean;
  extra?: ReactNode;
}) {
  const navButton = "flex size-9 items-center justify-center rounded-[8px] border border-line-strong bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink";
  const createDate = query.date >= today ? query.date : today;
  const create = canCreate ? newHref(createDate) : null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex items-center gap-2">
        <Link href={calendarHref(basePath, query, { date: shiftAnchor(query.view, query.date, -1), session: null })} scroll={false} aria-label="Période précédente" className={navButton}>
          <ChevronLeft className="size-[18px]" aria-hidden />
        </Link>
        <Link href={calendarHref(basePath, query, { date: shiftAnchor(query.view, query.date, 1), session: null })} scroll={false} aria-label="Période suivante" className={navButton}>
          <ChevronRight className="size-[18px]" aria-hidden />
        </Link>
        <Link
          href={calendarHref(basePath, query, { date: today, session: null })}
          scroll={false}
          className="inline-flex h-9 items-center rounded-[8px] border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          Aujourd’hui
        </Link>
      </div>
      <h2 className="heading min-w-0 text-[20px] first-letter:uppercase sm:text-[22px]">{viewTitle(query.view, query.date)}</h2>

      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <nav aria-label="Vue du calendrier" className="flex rounded-[9px] bg-surface-3 p-[3px]">
          {CALENDAR_VIEWS.map((view) => (
            <Link
              key={view}
              href={calendarHref(basePath, query, { view, session: null })}
              scroll={false}
              aria-current={view === query.view ? "page" : undefined}
              className={cn(
                "rounded-[7px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
                view === query.view ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-ink-soft hover:text-ink",
              )}
            >
              {VIEW_LABELS[view]}
            </Link>
          ))}
        </nav>
        {extra}
        {mode === "coach" && canCreate && onPalette ? (
          <Button variant={paletteOpen ? "quiet" : "secondary"} onClick={onPalette} aria-pressed={paletteOpen} className="hidden xl:inline-flex">
            <LibraryBig aria-hidden />
            Modèles
          </Button>
        ) : null}
        {mode === "coach" && canCreate && (query.view === "week" || query.view === "month") ? (
          <Button variant="secondary" onClick={onCopyWeek}>
            <CopyPlus aria-hidden />
            <span className="hidden sm:inline">Copier une semaine</span>
            <span className="sm:hidden">Copier</span>
          </Button>
        ) : null}
        {create ? (
          <ButtonLink href={create}>
            <Plus aria-hidden />
            Séance
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------

interface ViewProps {
  basePath: string;
  byDate: Map<ISODate, CalendarSession[]>;
  eventsByDate: Map<ISODate, CalendarEvent[]>;
  today: ISODate;
  query: CalendarQuery;
  thresholds?: AthleteThresholds;
  sessionHref: (session: CalendarSession) => string;
  newHref: (date: ISODate) => string | null;
  dropTarget: (date: ISODate) => Record<string, unknown>;
  chipDrag: Partial<Pick<Parameters<typeof SessionChip>[0], "draggable" | "onDragStart" | "onDragEnd">>;
  over: ISODate | null;
  canCreate: boolean;
}

function EventBadge({ event }: { event: CalendarEvent }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[6px] bg-ink px-1.5 py-1 text-[11.5px] font-semibold text-canvas" title={event.location ?? undefined}>
      <Flag className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{event.name}</span>
      <span className="ml-auto shrink-0 opacity-70">{event.priority}</span>
    </span>
  );
}

function AddButton({ href, date, label = "Ajouter" }: { href: string | null; date: ISODate; label?: string }) {
  if (!href) return null;
  return (
    <Link
      href={href}
      aria-label={`${label} une séance le ${formatFullDate(date)}`}
      className="flex size-6 items-center justify-center rounded-[6px] text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <Plus className="size-4" aria-hidden />
    </Link>
  );
}

function WeekSummary({ sessions, monday }: { sessions: CalendarSession[]; monday: ISODate }) {
  const volume = plannedVolume(sessions);
  const max = Math.max(1, ...volume.bySport.map((v) => v.seconds));
  return (
    <div className="flex h-full flex-col gap-2 p-2.5">
      <p className="text-[11px] font-semibold text-muted">Semaine {isoWeekNumber(monday)}</p>
      <p className="figure text-[19px] leading-none text-ink">{volume.totalSeconds ? formatDuration(volume.totalSeconds) : "—"}</p>
      <ul className="space-y-1.5">
        {volume.bySport.map((v) => (
          <li key={v.sport} className="space-y-0.5">
            <span className="flex items-center justify-between gap-2 text-[11.5px] text-ink-soft">
              <span className="truncate">{SPORT_LABELS[v.sport]}</span>
              <span className="figure">{v.seconds ? formatDuration(v.seconds) : "—"}</span>
            </span>
            <span className="block h-[5px] overflow-hidden rounded-full bg-surface-3">
              <span className={cn("block h-full rounded-full", SPORT_STYLES[v.sport].solid)} style={{ width: `${(v.seconds / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {volume.unknownDuration ? (
        <p className="text-[11px] leading-snug text-muted">
          {volume.unknownDuration} séance{volume.unknownDuration > 1 ? "s" : ""} sans durée calculable, non comptée{volume.unknownDuration > 1 ? "s" : ""}.
        </p>
      ) : null}
    </div>
  );
}

function MonthView(props: ViewProps) {
  const { byDate, eventsByDate, today, query, thresholds, sessionHref, newHref, dropTarget, chipDrag, over } = props;
  const weeks = monthWeeks(query.date);
  const month = query.date.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2/60 xl:grid-cols-[repeat(7,minmax(0,1fr))_168px]">
        {dateRange(weeks[0][0], weeks[0][6]).map((day) => (
          <div key={day} className="px-2.5 py-2 text-[12px] font-semibold capitalize text-muted">
            {formatWeekdayShort(day)}
          </div>
        ))}
        <div className="hidden px-2.5 py-2 text-[12px] font-semibold text-muted xl:block">Volume prévu</div>
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-line last:border-b-0 xl:grid-cols-[repeat(7,minmax(0,1fr))_168px]">
          {week.map((day) => {
            const inMonth = day.slice(0, 7) === month;
            const isToday = day === today;
            const daySessions = byDate.get(day) ?? [];
            return (
              <div
                key={day}
                {...dropTarget(day)}
                className={cn(
                  "group/day min-h-[118px] min-w-0 border-r border-line p-1.5 transition-colors last:border-r-0 sm:min-h-[136px] xl:last:border-r",
                  !inMonth && "bg-surface-2/45",
                  over === day && "bg-swim-soft/60 outline-2 -outline-offset-2 outline-swim",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <Link
                    href={calendarHref(props.basePath, query, { view: "day", date: day, session: null })}
                    scroll={false}
                    className={cn(
                      "figure flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[12.5px]",
                      isToday ? "bg-ink text-canvas" : inMonth ? "text-ink-soft hover:bg-surface-2" : "text-muted/70 hover:bg-surface-2",
                    )}
                    aria-label={formatFullDate(day)}
                  >
                    {Number(day.slice(8))}
                  </Link>
                  {props.canCreate ? <AddButton href={newHref(day)} date={day} /> : null}
                </div>
                <div className="space-y-1">
                  {(eventsByDate.get(day) ?? []).map((event) => (
                    <EventBadge key={event.id} event={event} />
                  ))}
                  {daySessions.map((session) => (
                    <SessionChip
                      key={session.id}
                      session={session}
                      href={sessionHref(session)}
                      today={today}
                      thresholds={thresholds}
                      size="compact"
                      selected={query.session === session.id}
                      {...chipDrag}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <div className="hidden border-l border-line bg-surface-2/30 xl:block">
            <WeekSummary sessions={week.flatMap((d) => byDate.get(d) ?? [])} monday={week[0]} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DayColumn({ day, props, size }: { day: ISODate; props: ViewProps; size: "regular" | "large" }) {
  const { byDate, eventsByDate, today, query, thresholds, sessionHref, newHref, dropTarget, chipDrag, over } = props;
  const sessions = byDate.get(day) ?? [];
  const relative = relativeDay(day, today);
  return (
    <section
      {...dropTarget(day)}
      aria-label={formatFullDate(day)}
      className={cn("group/day min-w-0 rounded-[12px] p-1.5 transition-colors", over === day && "bg-swim-soft/60 outline-2 -outline-offset-2 outline-swim")}
    >
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="flex items-baseline gap-1.5">
          <span className={cn("text-[13px] font-semibold capitalize", day === today ? "text-ink" : "text-ink-soft")}>{formatWeekday(day)}</span>
          <span className={cn("figure text-[13px]", day === today ? "rounded-full bg-ink px-1.5 text-canvas" : "text-muted")}>{Number(day.slice(8))}</span>
          {relative && day !== today ? <span className="text-[12px] text-muted">{relative}</span> : null}
        </span>
        {props.canCreate ? <AddButton href={newHref(day)} date={day} /> : null}
      </header>
      <div className="space-y-1.5">
        {(eventsByDate.get(day) ?? []).map((event) => (
          <EventBadge key={event.id} event={event} />
        ))}
        {sessions.map((session) => (
          <SessionChip
            key={session.id}
            session={session}
            href={sessionHref(session)}
            today={today}
            thresholds={thresholds}
            size={size}
            selected={query.session === session.id}
            {...chipDrag}
          />
        ))}
        {!sessions.length && !(eventsByDate.get(day) ?? []).length ? <p className="px-1 py-2 text-[12px] text-muted/80">Repos</p> : null}
      </div>
    </section>
  );
}

/** Bandeau de volume de la semaine : total, barre empilée par discipline, légende. */
function WeekStrip({ sessions, monday }: { sessions: CalendarSession[]; monday: ISODate }) {
  const volume = plannedVolume(sessions);
  const total = Math.max(1, volume.totalSeconds);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[14px] border border-line bg-surface px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-semibold text-muted">Semaine {isoWeekNumber(monday)}</span>
        <span className="figure text-[22px] leading-none">{volume.totalSeconds ? formatDuration(volume.totalSeconds) : "—"}</span>
        <span className="text-[12px] text-muted">
          {volume.sessions} séance{volume.sessions > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {volume.bySport.map((v) => (
          <span key={v.sport} className={cn("h-full", SPORT_STYLES[v.sport].solid)} style={{ width: `${(v.seconds / total) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {volume.bySport.map((v) => (
          <li key={v.sport} className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <SportDot sport={v.sport} />
            {SPORT_LABELS[v.sport]}
            <span className="figure text-ink">{v.seconds ? formatDuration(v.seconds) : "—"}</span>
          </li>
        ))}
      </ul>
      {volume.unknownDuration ? (
        <p className="w-full text-[12px] text-muted">
          {volume.unknownDuration} séance{volume.unknownDuration > 1 ? "s" : ""} sans durée calculable, non comptée{volume.unknownDuration > 1 ? "s" : ""}.
        </p>
      ) : null}
    </div>
  );
}

function WeekView(props: ViewProps) {
  const monday = startOfWeek(props.query.date);
  const days = dateRange(monday, addDays(monday, 6));
  const weekSessions = days.flatMap((d) => props.byDate.get(d) ?? []);
  return (
    <div className="space-y-3">
      <WeekStrip sessions={weekSessions} monday={monday} />
      <div className="grid gap-1 rounded-[14px] border border-line bg-surface p-1.5 sm:grid-cols-2 lg:grid-cols-7 lg:divide-x lg:divide-line">
        {days.map((day) => (
          <DayColumn key={day} day={day} props={props} size="regular" />
        ))}
      </div>
    </div>
  );
}

function DayView(props: ViewProps) {
  return (
    <div className="max-w-2xl rounded-[14px] border border-line bg-surface p-2">
      <DayColumn day={props.query.date} props={props} size="large" />
    </div>
  );
}

function AgendaView(props: ViewProps) {
  const { from, to } = viewRange("agenda", props.query.date);
  const days = dateRange(from, to).filter((d) => (props.byDate.get(d)?.length ?? 0) > 0 || (props.eventsByDate.get(d)?.length ?? 0) > 0);
  if (!days.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-10 text-center text-[14px] text-muted">
        Aucune séance du {formatDayMonth(from)} au {formatDayMonth(to)}.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {days.map((day, index) => {
        const monday = startOfWeek(day);
        const newWeek = index === 0 || startOfWeek(days[index - 1]) !== monday;
        return (
          <div key={day}>
            {newWeek ? <p className="px-1 pb-1 pt-4 text-[12px] font-semibold text-muted first:pt-0">{formatWeekRange(monday)}</p> : null}
            <div className="rounded-[12px] border border-line bg-surface p-1.5">
              <DayColumn day={day} props={props} size="regular" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modèles à glisser et copie de semaine
// ---------------------------------------------------------------------------

function TemplatePalette({ templates, onClose }: { templates: TemplateSummary[]; onClose: () => void }) {
  return (
    <aside className="hidden self-start rounded-[14px] border border-line bg-surface p-3 xl:sticky xl:top-4 xl:block">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="heading text-[15px]">Modèles</h3>
        <button type="button" onClick={onClose} aria-label="Fermer les modèles" className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="mb-3 text-[12px] text-muted">Glissez un modèle sur un jour : il est ajouté en brouillon.</p>
      <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto">
        {templates.map((template) => {
          const Icon = SPORT_ICONS[template.sport];
          return (
            <li key={template.id}>
              <div
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(TEMPLATE_MIME, template.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="flex cursor-grab items-center gap-2.5 rounded-[8px] border border-line px-2.5 py-2 hover:border-line-strong active:cursor-grabbing"
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", SPORT_STYLES[template.sport].soft, SPORT_STYLES[template.sport].ink)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{template.name}</span>
                  <span className="figure text-[12px] text-muted">{template.planned_duration_s ? formatDuration(template.planned_duration_s) : SPORT_LABELS[template.sport]}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function CopyWeekDialog({
  open,
  onClose,
  athleteId,
  sourceMonday,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  athleteId: string;
  sourceMonday: ISODate;
  onDone: (text: string, tone: "success" | "error") => void;
}) {
  const [target, setTarget] = useState(addDays(sourceMonday, 7));
  const [asDraft, setAsDraft] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const targetMonday = startOfWeek(target);
  return (
    <Dialog open={open} onClose={onClose} title="Copier une semaine">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await copyWeek(athleteId, sourceMonday, targetMonday, asDraft ? "draft" : "keep");
            if (result.status === "ok") {
              onClose();
              onDone(
                result.count
                  ? `${result.count} séance${result.count > 1 ? "s" : ""} copiée${result.count > 1 ? "s" : ""} vers la semaine du ${formatWeekRange(targetMonday)}${asDraft ? ", en brouillon" : ""}.`
                  : "Aucune séance à copier dans cette semaine.",
                "success",
              );
            } else {
              setError(result.message);
            }
          });
        }}
        className="space-y-4"
      >
        <p className="text-[14px] text-ink-soft">
          Toutes les séances de la semaine du <span className="font-semibold text-ink">{formatWeekRange(sourceMonday)}</span>, sauf les annulées, sont
          recopiées jour pour jour.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="copy-target" className="block text-[13px] font-semibold text-ink-soft">
            Vers la semaine du
          </label>
          <input id="copy-target" type="date" value={target} onChange={(event) => event.target.value && setTarget(event.target.value)} className={cn(controlClasses, "h-10")} />
          <p className="text-[13px] text-muted">Semaine du {formatWeekRange(targetMonday)}</p>
        </div>
        <label className="flex items-start gap-3 text-[14px]">
          <input type="checkbox" checked={asDraft} onChange={(event) => setAsDraft(event.target.checked)} className="mt-1 size-[18px] accent-[var(--ink)]" />
          <span>
            <span className="font-medium">Copier en brouillon</span>
            <span className="block text-[13px] text-muted">L’athlète ne les verra qu’après publication. Sinon, chaque séance garde son état.</span>
          </span>
        </label>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending || targetMonday === sourceMonday}>
            {pending ? "Copie…" : "Copier"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SportStatusFilters({ basePath, query, sports }: { basePath: string; query: CalendarQuery; sports: SessionSport[] }) {
  const toggle = <T,>(list: T[] | undefined, value: T) => {
    const set = new Set(list ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set];
  };
  const statuses: SessionStatus[] = ["planned", "unreconciled", "cancelled"];
  return (
    <div
      className="-mx-4 mb-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Filtres"
    >
      {sports.map((sport) => {
        const active = query.sports?.includes(sport) ?? false;
        return (
          <Link
            key={sport}
            href={calendarHref(basePath, query, { sports: toggle(query.sports, sport), session: null })}
            scroll={false}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium",
              active ? cn("border-transparent", SPORT_STYLES[sport].soft, SPORT_STYLES[sport].ink, "font-semibold") : "border-line-strong bg-surface text-ink-soft",
            )}
          >
            <SportDot sport={sport} />
            {SPORT_LABELS[sport]}
          </Link>
        );
      })}
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
      {statuses.map((status) => {
        const active = query.statuses?.includes(status) ?? false;
        return (
          <Link
            key={status}
            href={calendarHref(basePath, query, { statuses: toggle(query.statuses, status), session: null })}
            scroll={false}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium",
              active ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink-soft",
            )}
          >
            {STATUS_LABELS[status]}
          </Link>
        );
      })}
    </div>
  );
}
