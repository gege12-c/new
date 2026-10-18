/**
 * Dates locales du calendrier (« AAAA-MM-JJ »), sans fuseau : une séance sans heure est une
 * date de l’athlète, pas un instant. Toutes les opérations se font en UTC pour éviter les
 * décalages d’heure d’été, puis sont formatées sans conversion.
 */

export type ISODate = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const toDate = (iso: ISODate) => new Date(`${iso}T00:00:00Z`);
const fromDate = (date: Date): ISODate => date.toISOString().slice(0, 10);

export function addDays(iso: ISODate, days: number): ISODate {
  const date = toDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromDate(date);
}

/** Lundi de la semaine (semaine ISO, du lundi au dimanche). */
export function startOfWeek(iso: ISODate): ISODate {
  const day = (toDate(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -day);
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayIndex(iso: ISODate): number {
  return (toDate(iso).getUTCDay() + 6) % 7;
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const date = toDate(startOfMonth(iso));
  date.setUTCMonth(date.getUTCMonth() + months);
  return fromDate(date);
}

export function endOfMonth(iso: ISODate): ISODate {
  return addDays(addMonths(iso, 1), -1);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const days: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Semaines (du lundi au dimanche) qui couvrent le mois de la date donnée. */
export function monthWeeks(iso: ISODate): ISODate[][] {
  const first = startOfWeek(startOfMonth(iso));
  const last = endOfMonth(iso);
  const weeks: ISODate[][] = [];
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
    weeks.push(dateRange(monday, addDays(monday, 6)));
  }
  return weeks;
}

/** Numéro de semaine ISO 8601 (la semaine 1 contient le premier jeudi de l’année). */
export function isoWeekNumber(iso: ISODate): number {
  const thursday = toDate(addDays(startOfWeek(iso), 3));
  const yearStart = toDate(`${thursday.getUTCFullYear()}-01-04`);
  const firstThursday = toDate(addDays(startOfWeek(fromDate(yearStart)), 3));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", ...options });
const weekdayShort = fmt({ weekday: "short" });
const weekdayLong = fmt({ weekday: "long" });
const dayMonth = fmt({ day: "numeric", month: "short" });
const dayMonthLong = fmt({ day: "numeric", month: "long" });
const monthYear = fmt({ month: "long", year: "numeric" });
const fullDate = fmt({ weekday: "long", day: "numeric", month: "long" });
const fullDateYear = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** « lun. » */
export const formatWeekdayShort = (iso: ISODate) => weekdayShort.format(toDate(iso));
/** « lundi » */
export const formatWeekday = (iso: ISODate) => weekdayLong.format(toDate(iso));
/** « 19 oct. » */
export const formatDayMonth = (iso: ISODate) => dayMonth.format(toDate(iso));
/** « 19 octobre » */
export const formatDayMonthLong = (iso: ISODate) => dayMonthLong.format(toDate(iso));
/** « octobre 2026 » */
export const formatMonthYear = (iso: ISODate) => monthYear.format(toDate(iso));
/** « lundi 19 octobre » (avec l’année si elle diffère de `referenceYear`). */
export function formatFullDate(iso: ISODate, referenceYear?: string) {
  return referenceYear && iso.slice(0, 4) !== referenceYear ? fullDateYear.format(toDate(iso)) : fullDate.format(toDate(iso));
}

/** « 19 – 25 oct. 2026 » ou « 26 oct. – 1 nov. 2026 ». */
export function formatWeekRange(monday: ISODate): string {
  const sunday = addDays(monday, 6);
  const year = sunday.slice(0, 4);
  if (monday.slice(0, 7) === sunday.slice(0, 7)) {
    return `${Number(monday.slice(8))} – ${dayMonth.format(toDate(sunday))} ${year}`;
  }
  return `${dayMonth.format(toDate(monday))} – ${dayMonth.format(toDate(sunday))} ${year}`;
}

/** « aujourd’hui », « demain », « hier », sinon null. */
export function relativeDay(iso: ISODate, today: ISODate): string | null {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "aujourd’hui";
  if (diff === 1) return "demain";
  if (diff === -1) return "hier";
  return null;
}

// ---------------------------------------------------------------------------
// Vues du calendrier
// ---------------------------------------------------------------------------

export const CALENDAR_VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Mois",
  week: "Semaine",
  day: "Jour",
  agenda: "Liste",
};

/** Nombre de jours affichés par la vue liste. */
export const AGENDA_DAYS = 28;

export function viewRange(view: CalendarView, anchor: ISODate): { from: ISODate; to: ISODate } {
  switch (view) {
    case "month": {
      const weeks = monthWeeks(anchor);
      return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
    }
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "day":
      return { from: anchor, to: anchor };
    case "agenda":
      return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) };
  }
}

export function shiftAnchor(view: CalendarView, anchor: ISODate, direction: -1 | 1): ISODate {
  switch (view) {
    case "month":
      return addMonths(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "day":
      return addDays(anchor, direction);
    case "agenda":
      return addDays(anchor, AGENDA_DAYS * direction);
  }
}

export function viewTitle(view: CalendarView, anchor: ISODate): string {
  switch (view) {
    case "month":
      return formatMonthYear(anchor);
    case "week":
      return formatWeekRange(startOfWeek(anchor));
    case "day":
      return formatFullDate(anchor);
    case "agenda": {
      const { to } = viewRange("agenda", anchor);
      return `${formatDayMonthLong(anchor)} – ${formatDayMonthLong(to)}`;
    }
  }
}

/** Lit la vue et la date d’ancrage dans les paramètres de l’URL ; valeurs par défaut sûres. */
export function readCalendarParams(
  params: Record<string, string | string[] | undefined>,
  today: ISODate,
  defaultView: CalendarView,
): { view: CalendarView; anchor: ISODate } {
  const view = typeof params.view === "string" && (CALENDAR_VIEWS as readonly string[]).includes(params.view) ? (params.view as CalendarView) : defaultView;
  const anchor = isISODate(params.date) ? params.date : today;
  return { view, anchor };
}
