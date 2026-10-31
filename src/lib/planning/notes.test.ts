import { describe, expect, it } from "vitest";
import { calendarHref, readCalendarQuery } from "./calendar-query";
import { coversDay, isUnavailability, notesByDay, noteTitle, type CalendarNote } from "./notes";

const note = (overrides: Partial<CalendarNote> = {}): CalendarNote => ({
  id: "0b6f9d3c-2f4e-4c1a-9a57-3d2c1b0a9e8f",
  athlete_id: "a",
  kind: "unavailable",
  start_date: "2026-11-02",
  end_date: "2026-11-04",
  title: "Rotation Tokyo",
  note: null,
  created_by: "a",
  ...overrides,
});

describe("notes de calendrier", () => {
  it("une note de plusieurs jours apparaît chaque jour qu’elle couvre", () => {
    const map = notesByDay([note(), note({ id: "n2", kind: "note", start_date: "2026-11-04", end_date: "2026-11-04", title: null })], [
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect([...map.keys()]).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(map.get("2026-11-04")?.map((n) => n.id)).toEqual([note().id, "n2"]);
    expect(coversDay(note(), "2026-11-05")).toBe(false);
  });

  it("intitulés et indisponibilité", () => {
    expect(noteTitle(note())).toBe("Indisponible : Rotation Tokyo");
    expect(noteTitle(note({ kind: "sick", title: null }))).toBe("Malade");
    expect(isUnavailability(note({ kind: "travel" }))).toBe(true);
    expect(isUnavailability(note({ kind: "note" }))).toBe(false);
  });

  it("la note ouverte vit dans l’adresse du calendrier, un seul panneau à la fois", () => {
    const query = readCalendarQuery({ view: "week", date: "2026-11-02", note: "new" }, "2026-10-31", "week");
    expect(query.note).toBe("new");
    expect(calendarHref("/athlete/calendar", query)).toBe("/athlete/calendar?view=week&date=2026-11-02&note=new");
    // Ouvrir une séance referme la note.
    expect(calendarHref("/athlete/calendar", query, { session: note().id })).toBe(`/athlete/calendar?view=week&date=2026-11-02&session=${note().id}`);
    expect(readCalendarQuery({ note: "pas-un-identifiant" }, "2026-10-31", "week").note).toBeNull();
  });
});
