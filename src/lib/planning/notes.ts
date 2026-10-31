/** Notes de calendrier et jours indisponibles : types, libellés, couverture des jours. */
import type { ISODate } from "./dates";

export const NOTE_KINDS = ["unavailable", "travel", "sick", "injured", "holiday", "note"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_LABELS: Record<NoteKind, string> = {
  unavailable: "Indisponible",
  travel: "Déplacement",
  sick: "Malade",
  injured: "Blessure",
  holiday: "Vacances",
  note: "Note",
};

/** Exemple affiché dans le formulaire pour chaque type. */
export const NOTE_HINTS: Record<NoteKind, string> = {
  unavailable: "Rotation, travail, obligation : pas d’entraînement possible.",
  travel: "Entraînement possible, mais sans son matériel habituel.",
  sick: "Repos jusqu’à nouvel ordre.",
  injured: "Blessure : précisez ce qui reste possible.",
  holiday: "Congés : à préciser si l’entraînement continue.",
  note: "Information pour le coach ou pour soi.",
};

export interface CalendarNote {
  id: string;
  athlete_id: string;
  kind: NoteKind;
  start_date: ISODate;
  end_date: ISODate;
  title: string | null;
  note: string | null;
  created_by: string | null;
}

/** Une note qui empêche ou limite l’entraînement (tout sauf la simple note). */
export const isUnavailability = (note: Pick<CalendarNote, "kind">) => note.kind !== "note";

export const coversDay = (note: Pick<CalendarNote, "start_date" | "end_date">, day: ISODate) => note.start_date <= day && day <= note.end_date;

/** Notes par jour, sur une période (une note de plusieurs jours apparaît chaque jour). */
export function notesByDay(notes: CalendarNote[], days: ISODate[]): Map<ISODate, CalendarNote[]> {
  const map = new Map<ISODate, CalendarNote[]>();
  for (const day of days) {
    const covering = notes.filter((n) => coversDay(n, day));
    if (covering.length) map.set(day, covering);
  }
  return map;
}

/** Intitulé court : « Indisponible : Rotation Tokyo ». */
export const noteTitle = (note: Pick<CalendarNote, "kind" | "title">) => (note.title ? `${NOTE_LABELS[note.kind]} : ${note.title}` : NOTE_LABELS[note.kind]);
