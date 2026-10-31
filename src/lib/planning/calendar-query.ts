/** Paramètres d’URL du calendrier (vue, date, filtres, séance ouverte), partagés serveur et client. */
import type { SessionSport } from "@/lib/workout/schema";
import { SESSION_SPORTS } from "@/lib/workout/schema";
import { readCalendarParams, type CalendarView, type ISODate } from "./dates";
import type { SessionStatus } from "./status";

export interface CalendarQuery {
  view: CalendarView;
  date: ISODate;
  session?: string | null;
  /** Activité ouverte dans le panneau (non rattachée à une séance). */
  activity?: string | null;
  /** Note de calendrier ouverte dans le panneau : son identifiant, ou « new » pour en poser une. */
  note?: string | null;
  sports?: SessionSport[];
  statuses?: SessionStatus[];
}

const STATUSES: SessionStatus[] = ["draft", "planned", "done", "partial", "missed", "unreconciled", "cancelled"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Construit l’URL du calendrier avec des paramètres modifiés (les autres sont conservés). */
export function calendarHref(basePath: string, query: CalendarQuery, change: Partial<CalendarQuery> = {}): string {
  const next = { ...query, ...change };
  // Un seul panneau à la fois : ouvrir ou fermer une séance referme l’activité et la note ouvertes.
  if ("session" in change && !("activity" in change)) next.activity = null;
  if (("session" in change || "activity" in change) && !("note" in change)) next.note = null;
  if (change.note) {
    next.session = null;
    next.activity = null;
  }
  const params = new URLSearchParams();
  params.set("view", next.view);
  params.set("date", next.date);
  if (next.sports?.length) params.set("sport", next.sports.join(","));
  if (next.statuses?.length) params.set("status", next.statuses.join(","));
  if (next.session) params.set("session", next.session);
  else if (next.activity) params.set("activity", next.activity);
  else if (next.note) params.set("note", next.note);
  return `${basePath}?${params.toString()}`;
}

/** Lit les paramètres d’URL ; toute valeur inconnue est ignorée. */
export function readCalendarQuery(
  params: Record<string, string | string[] | undefined>,
  today: ISODate,
  defaultView: CalendarView,
): CalendarQuery {
  const { view, anchor } = readCalendarParams(params, today, defaultView);
  const list = (key: string) => (typeof params[key] === "string" ? (params[key] as string).split(",") : []);
  const session = typeof params.session === "string" && UUID_RE.test(params.session) ? params.session : null;
  const activity = !session && typeof params.activity === "string" && UUID_RE.test(params.activity) ? params.activity : null;
  const note = !session && !activity && typeof params.note === "string" && (params.note === "new" || UUID_RE.test(params.note)) ? params.note : null;
  return {
    view,
    date: anchor,
    session,
    activity,
    note,
    sports: list("sport").filter((s): s is SessionSport => (SESSION_SPORTS as readonly string[]).includes(s)),
    statuses: list("status").filter((s): s is SessionStatus => STATUSES.includes(s as SessionStatus)),
  };
}
