import { describe, expect, it } from "vitest";
import { bikeThreshold } from "@/lib/workout/fixtures";
import { buildCalendar, escapeText, foldLine, type CalendarFeed } from "./ics";

const base: CalendarFeed = {
  status: "ok",
  athlete: { name: "Léa", timezone: "Europe/Paris" },
  sessions: [
    {
      id: "s1",
      scheduled_date: "2026-11-03",
      start_time: "18:30:00",
      sport: "bike",
      title: "Seuil 4 × 8 min",
      objective: "threshold",
      description: "Rester assis, cadence 90.",
      nutrition_notes: "1 bidon",
      content: bikeThreshold,
      planned_duration_s: 3900,
      planned_distance_m: null,
      state: "published",
      version: 3,
      updated_at: "2026-10-31T08:00:00Z",
    },
    {
      id: "s2",
      scheduled_date: "2026-11-04",
      start_time: null,
      sport: "run",
      title: "Footing",
      objective: null,
      description: null,
      nutrition_notes: null,
      content: { not: "a workout" },
      planned_duration_s: null,
      planned_distance_m: null,
      state: "cancelled",
      version: 2,
      updated_at: "2026-10-31T08:00:00Z",
    },
  ],
  events: [{ id: "e1", name: "Ironman Nice", event_date: "2027-06-27", priority: "A", location: "Nice, France", updated_at: "2026-10-01T08:00:00Z" }],
  thresholds: [{ sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" }],
  notes: [{ id: "n1", kind: "unavailable", start_date: "2026-11-05", end_date: "2026-11-07", title: "Rotation Tokyo", updated_at: "2026-10-31T08:00:00Z" }],
};

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("agenda iCalendar", () => {
  it("échappe et replie les lignes sans couper un caractère", () => {
    expect(escapeText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
    const folded = foldLine(`DESCRIPTION:${"é".repeat(80)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"é".repeat(80)}`);
  });

  it("séance à heure fixe : instant UTC calculé dans le fuseau, durée prévue, cibles en watts", () => {
    const ics = buildCalendar(base, { siteUrl: "https://tricoach.test", now: new Date("2026-10-31T09:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const text = unfold(ics);
    expect(text).toContain("UID:session-s1@tricoach");
    expect(text).toContain("SUMMARY:Vélo : Seuil 4 × 8 min");
    // 18 h 30 à Paris le 3 novembre = 17 h 30 UTC ; 65 minutes prévues.
    expect(text).toContain("DTSTART:20261103T173000Z");
    expect(text).toContain("DTEND:20261103T183500Z");
    expect(text).toContain("SEQUENCE:3");
    expect(text).toMatch(/DESCRIPTION:Objectif : [^\r\n]+\\nPrévu : 1 h 05/);
    expect(text).toContain("238–250 W");
    expect(text).toContain("Nutrition : 1 bidon");
    expect(text).toContain("URL:https://tricoach.test/athlete/calendar?view=day&date=2026-11-03&session=s1");
  });

  it("séance sans heure : journée entière ; annulée : marquée pour disparaître des agendas", () => {
    const text = unfold(buildCalendar(base, { siteUrl: "https://tricoach.test", now: new Date("2026-10-31T09:00:00Z") }));
    const footing = text.slice(text.indexOf("UID:session-s2@tricoach"));
    expect(footing).toContain("DTSTART;VALUE=DATE:20261104");
    expect(footing).toContain("DTEND;VALUE=DATE:20261105");
    expect(footing).toContain("STATUS:CANCELLED");
  });

  it("compétitions et jours indisponibles en journées entières, sans bloquer l'agenda", () => {
    const text = unfold(buildCalendar(base, { siteUrl: "https://tricoach.test", now: new Date("2026-10-31T09:00:00Z") }));
    expect(text).toContain("SUMMARY:Compétition : Ironman Nice (A)");
    expect(text).toContain("LOCATION:Nice\\, France");
    expect(text).toContain("SUMMARY:Indisponible : Rotation Tokyo");
    const note = text.slice(text.indexOf("UID:note-n1@tricoach"));
    expect(note).toContain("DTSTART;VALUE=DATE:20261105");
    expect(note).toContain("DTEND;VALUE=DATE:20261108");
    expect(note).toContain("TRANSP:TRANSPARENT");
  });
});
