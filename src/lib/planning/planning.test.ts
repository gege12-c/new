import { describe, expect, it } from "vitest";
import { WorkoutSchema } from "@/lib/workout/schema";
import { bikeThreshold } from "@/lib/workout/fixtures";
import {
  addDays,
  addMonths,
  formatWeekRange,
  isISODate,
  isoWeekNumber,
  monthWeeks,
  readCalendarParams,
  relativeDay,
  shiftAnchor,
  startOfWeek,
  viewRange,
  viewTitle,
} from "./dates";
import { snapshotToValues } from "./editor-values";
import { changedFields, normalizeTime, SessionValuesSchema, snapshotOf } from "./snapshot";
import { sessionStatus } from "./status";
import { plannedVolume } from "./volume";

describe("dates du calendrier", () => {
  it("calcule semaines, mois et numéros ISO sans décalage d'heure d'été", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(isoWeekNumber("2026-10-19")).toBe(43);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(isoWeekNumber("2027-01-04")).toBe(1);
    const weeks = monthWeeks("2026-11-15");
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks.at(-1)?.[6]).toBe("2026-12-06");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("donne les bornes et le titre de chaque vue", () => {
    expect(viewRange("week", "2026-10-22")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(viewRange("day", "2026-10-22")).toEqual({ from: "2026-10-22", to: "2026-10-22" });
    expect(viewRange("agenda", "2026-10-22").to).toBe("2026-11-18");
    expect(shiftAnchor("month", "2026-10-22", 1)).toBe("2026-11-01");
    expect(formatWeekRange("2026-10-19")).toBe("19 – 25 oct. 2026");
    expect(formatWeekRange("2026-10-26")).toBe("26 oct. – 1 nov. 2026");
    expect(viewTitle("month", "2026-10-22")).toBe("octobre 2026");
    expect(relativeDay("2026-10-19", "2026-10-18")).toBe("demain");
  });

  it("valide les paramètres d'URL", () => {
    expect(isISODate("2026-02-30")).toBe(false);
    expect(readCalendarParams({ view: "week", date: "2026-10-20" }, "2026-10-18", "month")).toEqual({ view: "week", anchor: "2026-10-20" });
    expect(readCalendarParams({ view: "année", date: "hier" }, "2026-10-18", "month")).toEqual({ view: "month", anchor: "2026-10-18" });
  });
});

describe("état modifiable d'une séance", () => {
  const content = WorkoutSchema.parse(bikeThreshold);
  const row = {
    scheduled_date: "2026-10-20",
    start_time: "18:30:00",
    sport: "bike",
    title: "Seuil",
    objective: "threshold",
    description: null,
    nutrition_notes: null,
    content,
    planned_duration_s: 4140,
    planned_distance_m: "0.0",
  };

  it("normalise les heures et repère les champs changés, sans dépendre de l'ordre des clés", () => {
    expect(normalizeTime("7:30")).toBe("07:30:00");
    expect(() => normalizeTime("25:00")).toThrow();
    const base = snapshotOf(row);
    expect(base.planned_distance_m).toBe(0);
    const reordered = { ...base, content: JSON.parse(JSON.stringify({ segments: content.segments, schemaVersion: 1 })) };
    expect(changedFields(base, reordered)).toEqual([]);
    expect(changedFields(base, { ...base, title: "Seuil long", start_time: null })).toEqual(["start_time", "title"]);
  });

  it("valide les valeurs envoyées par l'éditeur (les totaux sont recalculés par le serveur)", () => {
    const values: Partial<ReturnType<typeof snapshotOf>> = { ...snapshotOf(row) };
    delete values.planned_duration_s;
    delete values.planned_distance_m;
    expect(SessionValuesSchema.safeParse(snapshotOf(row)).success).toBe(false);
    const ok = SessionValuesSchema.safeParse({ ...values, title: "  Seuil  ", description: "  ", start_time: "6:05" });
    expect(ok.success && ok.data.title).toBe("Seuil");
    expect(ok.success && ok.data.description).toBeNull();
    expect(ok.success && ok.data.start_time).toBe("06:05:00");
    const bad = SessionValuesSchema.safeParse({ ...values, title: "", start_time: "99:00" });
    expect(bad.success).toBe(false);
  });
});

describe("statut et volumes", () => {
  it("ne déclare jamais une séance passée faite ou manquée sans activité", () => {
    expect(sessionStatus({ state: "published", scheduled_date: "2026-10-17" }, "2026-10-18")).toBe("unreconciled");
    expect(sessionStatus({ state: "published", scheduled_date: "2026-10-18" }, "2026-10-18")).toBe("planned");
    expect(sessionStatus({ state: "cancelled", scheduled_date: "2026-10-20" }, "2026-10-18")).toBe("cancelled");
  });

  it("additionne les volumes prévus et isole les durées inconnues", () => {
    const summary = plannedVolume([
      { sport: "bike", state: "published", planned_duration_s: 3600, planned_distance_m: null },
      { sport: "bike", state: "draft", planned_duration_s: 1800, planned_distance_m: null },
      { sport: "run", state: "published", planned_duration_s: null, planned_distance_m: "10000.0" },
      { sport: "swim", state: "cancelled", planned_duration_s: 2400, planned_distance_m: 2500 },
    ]);
    expect(summary.bySport.map((v) => v.sport)).toEqual(["bike", "run"]);
    expect(summary.totalSeconds).toBe(5400);
    expect(summary.unknownDuration).toBe(1);
    expect(summary.bySport[1].meters).toBe(10000);
  });
});

describe("valeurs de l'éditeur", () => {
  it("complète un contenu écrit hors de l'éditeur, sans toucher au reste", () => {
    const partial = {
      schemaVersion: 1,
      segments: [{ id: "bike", sport: "bike", steps: [{ kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 } }] }],
    };
    const snapshot = { scheduled_date: "2026-10-19", start_time: "18:00:00", title: "Retour au calme", content: partial } as unknown as Parameters<typeof snapshotToValues>[0];
    const values = snapshotToValues(snapshot);
    expect(values.start_time).toBe("18:00");
    const step = values.content.segments[0].steps[0];
    expect(step.kind === "step" && step.targets).toEqual([]);
    // Un contenu invalide n'est pas réécrit en silence : il reste tel quel.
    const invalid = { schemaVersion: 1, segments: [] };
    expect(snapshotToValues({ ...snapshot, content: invalid } as unknown as Parameters<typeof snapshotToValues>[0]).content).toBe(invalid);
  });
});
