/** Paramètres d’URL du calendrier (vue, date, filtres, séance ouverte), partagés serveur et client. */
import type { SessionSport } from "@/lib/workout/schema";
import { SESSION_SPORTS } from "@/lib/workout/schema";
import { readCalendarParams, type CalendarView, type ISODate } from "./dates";
import type { SessionStatus } from "./status";

export interface CalendarQuery {
  view: CalendarView;
  date: ISODate;
  session?: string | null;
  sports?: SessionSport[];
  statuses?: SessionStatus[];
}

const STATUSES: SessionStatus[] = ["draft", "planned", "unreconciled", "cancelled"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Construit l’URL du calendrier avec des paramètres modifiés (les autres sont conservés). */
export function calendarHref(basePath: string, query: CalendarQuery, change: Partial<CalendarQuery> = {}): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  params.set("view", next.view);
  params.set("date", next.date);
  if (next.sports?.length) params.set("sport", next.sports.join(","));
  if (next.statuses?.length) params.set("status", next.statuses.join(","));
  if (next.session) params.set("session", next.session);
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
  return {
    view,
    date: anchor,
    session,
    sports: list("sport").filter((s): s is SessionSport => (SESSION_SPORTS as readonly string[]).includes(s)),
    statuses: list("status").filter((s): s is SessionStatus => STATUSES.includes(s as SessionStatus)),
  };
}
