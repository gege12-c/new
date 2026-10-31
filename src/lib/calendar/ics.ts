/**
 * Agenda du téléphone : séances publiées, compétitions et jours indisponibles au format iCalendar
 * (RFC 5545), relu par Google Agenda, Apple Calendrier ou Outlook depuis l'adresse d'abonnement.
 *
 * Une séance sans heure est une date locale : événement « journée entière ». Avec une heure, l'instant
 * est calculé dans le fuseau de l'athlète puis écrit en UTC (sans définition de fuseau à fournir).
 * Une séance annulée reste dans le flux, marquée annulée, pour disparaître des agendas déjà abonnés.
 */
import { z } from "zod";
import { workoutSheet } from "@/lib/export/sheet";

import { NOTE_LABELS, type NoteKind } from "@/lib/planning/notes";
import { currentThresholds, toAthleteThresholds, type ThresholdRow } from "@/lib/thresholds";
import { zonedLocalToUtc } from "@/lib/time-zone";
import { formatDistance, formatDurationShort } from "@/lib/workout/format";
import { OBJECTIVE_LABELS, parseWorkout, SPORT_LABELS, type SessionObjective, type SessionSport } from "@/lib/workout/schema";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CalendarFeedSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unauthorized") }),
  z.object({
    status: z.literal("ok"),
    athlete: z.object({ name: z.string(), timezone: z.string().nullable() }),
    sessions: z.array(
      z.object({
        id: z.string(),
        scheduled_date: date,
        start_time: z.string().nullable(),
        sport: z.string(),
        title: z.string(),
        objective: z.string().nullable(),
        description: z.string().nullable(),
        nutrition_notes: z.string().nullable(),
        content: z.unknown(),
        planned_duration_s: z.number().nullable(),
        planned_distance_m: z.union([z.number(), z.string()]).nullable(),
        state: z.enum(["published", "cancelled"]),
        version: z.number(),
        updated_at: z.string(),
      }),
    ),
    events: z.array(z.object({ id: z.string(), name: z.string(), event_date: date, priority: z.string(), location: z.string().nullable(), updated_at: z.string() })),
    thresholds: z.array(z.object({ sport: z.string(), metric: z.string(), value: z.union([z.number(), z.string()]), effective_from: date })),
    notes: z.array(z.object({ id: z.string(), kind: z.string(), start_date: date, end_date: date, title: z.string().nullable(), updated_at: z.string() })),
  }),
]);
export type CalendarFeed = Extract<z.infer<typeof CalendarFeedSchema>, { status: "ok" }>;

/** Texte d'une propriété : barre oblique inverse, point-virgule, virgule et retours à la ligne échappés. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lignes repliées à 75 octets (UTF-8), sans couper un caractère ; fin de ligne CRLF. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75; // une ligne de suite commence par une espace
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");
const utcStamp = (instant: Date) => instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function event(props: [string, string][]): string[] {
  return ["BEGIN:VEVENT", ...props.map(([key, value]) => foldLine(`${key}:${value}`)), "END:VEVENT"];
}

export interface IcsOptions {
  /** Adresse du site, pour le lien vers chaque séance. */
  siteUrl: string;
  now: Date;
}

/** Description d'une séance : objectif, volume, étapes (cibles en valeurs absolues si possible), consignes. */
function sessionDescription(session: CalendarFeed["sessions"][number], thresholdRows: ThresholdRow[], siteUrl: string): string {
  const lines: string[] = [];
  if (session.objective) lines.push(`Objectif : ${OBJECTIVE_LABELS[session.objective as SessionObjective] ?? session.objective}`);
  const volume = [
    session.planned_duration_s ? formatDurationShort(session.planned_duration_s) : null,
    session.planned_distance_m ? formatDistance(Number(session.planned_distance_m), session.sport === "swim" ? "swim" : undefined) : null,
  ].filter(Boolean);
  if (volume.length) lines.push(`Prévu : ${volume.join(", ")}`);
  const workout = parseWorkout(session.content);
  if (workout.success) {
    const thresholds = toAthleteThresholds(currentThresholds(thresholdRows, session.scheduled_date));
    // La fiche reprend le titre en tête : on le retire, il est déjà le nom de l'événement.
    lines.push("", ...workoutSheet(workout.data, { title: session.title, thresholds, description: session.description }).split("\n").slice(1));
  } else if (session.description) {
    lines.push("", session.description);
  }
  if (session.nutrition_notes) lines.push("", `Nutrition : ${session.nutrition_notes}`);
  lines.push("", `Ouvrir dans TriCoach : ${siteUrl}/athlete/calendar?view=day&date=${session.scheduled_date}&session=${session.id}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Flux complet, prêt à servir en « text/calendar ». */
export function buildCalendar(feed: CalendarFeed, options: IcsOptions): string {
  const timeZone = feed.athlete.timezone || "Europe/Paris";
  const stamp = utcStamp(options.now);
  const thresholdRows: ThresholdRow[] = feed.thresholds.map((t) => ({ ...t, value: Number(t.value) }));
  const out: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TriCoach//Agenda des seances//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeText("TriCoach : entraînement")}`),
    foldLine(`X-WR-CALDESC:${escapeText(`Séances publiées de ${feed.athlete.name}`)}`),
    `X-WR-TIMEZONE:${timeZone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const session of feed.sessions) {
    const sport = SPORT_LABELS[session.sport as SessionSport] ?? session.sport;
    const props: [string, string][] = [
      ["UID", `session-${session.id}@tricoach`],
      ["DTSTAMP", stamp],
      ["LAST-MODIFIED", utcStamp(new Date(session.updated_at))],
      ["SEQUENCE", String(Math.max(0, session.version))],
      ["SUMMARY", escapeText(`${sport} : ${session.title}`)],
      ["STATUS", session.state === "cancelled" ? "CANCELLED" : "CONFIRMED"],
      ["CATEGORIES", escapeText(sport)],
      ["DESCRIPTION", escapeText(sessionDescription(session, thresholdRows, options.siteUrl))],
      ["URL", `${options.siteUrl}/athlete/calendar?view=day&date=${session.scheduled_date}&session=${session.id}`],
    ];
    if (session.start_time && /^\d{2}:\d{2}/.test(session.start_time)) {
      const start = zonedLocalToUtc(`${session.scheduled_date}T${session.start_time.slice(0, 5)}:00`, timeZone);
      const end = new Date(start.getTime() + (session.planned_duration_s && session.planned_duration_s > 0 ? session.planned_duration_s : 3600) * 1000);
      props.push(["DTSTART", utcStamp(start)], ["DTEND", utcStamp(end)]);
    } else {
      props.push(["DTSTART;VALUE=DATE", compactDate(session.scheduled_date)], ["DTEND;VALUE=DATE", compactDate(nextDay(session.scheduled_date))], ["TRANSP", "TRANSPARENT"]);
    }
    out.push(...event(props));
  }

  for (const race of feed.events) {
    out.push(
      ...event([
        ["UID", `event-${race.id}@tricoach`],
        ["DTSTAMP", stamp],
        ["LAST-MODIFIED", utcStamp(new Date(race.updated_at))],
        ["SUMMARY", escapeText(`Compétition : ${race.name} (${race.priority})`)],
        ["DTSTART;VALUE=DATE", compactDate(race.event_date)],
        ["DTEND;VALUE=DATE", compactDate(nextDay(race.event_date))],
        ...(race.location ? ([["LOCATION", escapeText(race.location)]] as [string, string][]) : []),
        ["TRANSP", "TRANSPARENT"],
      ]),
    );
  }

  for (const note of feed.notes) {
    const label = NOTE_LABELS[note.kind as NoteKind] ?? "Indisponible";
    out.push(
      ...event([
        ["UID", `note-${note.id}@tricoach`],
        ["DTSTAMP", stamp],
        ["LAST-MODIFIED", utcStamp(new Date(note.updated_at))],
        ["SUMMARY", escapeText(note.title ? `${label} : ${note.title}` : label)],
        ["DTSTART;VALUE=DATE", compactDate(note.start_date)],
        ["DTEND;VALUE=DATE", compactDate(nextDay(note.end_date))],
        ["TRANSP", "TRANSPARENT"],
      ]),
    );
  }

  out.push("END:VCALENDAR");
  return `${out.join("\r\n")}\r\n`;
}
