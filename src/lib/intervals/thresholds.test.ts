import { describe, expect, it } from "vitest";
import type { IntervalsSportSettings } from "./api";
import { alignmentUpdates, appliedAsSent, compareThresholds } from "./thresholds";

const settings: IntervalsSportSettings[] = [
  { id: "11", types: ["Ride", "VirtualRide"], ftp: 230, lthr: 176, maxHr: 195, thresholdPaceMps: null },
  // 5:15 /km = 1000 / 315 m/s.
  { id: "12", types: ["Run", "VirtualRun"], ftp: null, lthr: 176, maxHr: 195, thresholdPaceMps: 1000 / 315 },
  // 1:40 /100 m = 1 m/s.
  { id: "13", types: ["Swim"], ftp: null, lthr: null, maxHr: null, thresholdPaceMps: 1 },
];

describe("seuils TriCoach et intervals.icu", () => {
  it("met les deux côte à côte, dans les unités de TriCoach", () => {
    const rows = compareThresholds({ "bike.ftp_w": 230, "run.threshold_pace_s_per_km": 300, "run.lthr_bpm": 180, "general.max_hr_bpm": 195 }, settings);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["Ride.ftp"]).toMatchObject({ tricoach: 230, intervals: 230, same: true, settingsId: "11" });
    expect(byId["Run.threshold_pace"]).toMatchObject({ tricoach: 300, intervals: 315, same: false, settingsId: "12" });
    expect(byId["Run.lthr"]).toMatchObject({ tricoach: 180, intervals: 176, same: false });
    // Seuil absent de TriCoach mais présent chez intervals.icu : montré, pour pouvoir le reprendre.
    expect(byId["Swim.threshold_pace"]).toMatchObject({ tricoach: null, intervals: 100, same: false });
    expect(byId["Ride.lthr"]).toMatchObject({ tricoach: null, intervals: 176, same: false });
    expect(byId["Run.max_hr"].same).toBe(true);
    expect(byId["Ride.max_hr"].same).toBe(true);
  });

  it("aligne intervals.icu sur TriCoach : seuls les écarts partent, en unités SI", () => {
    const rows = compareThresholds({ "bike.ftp_w": 240, "run.threshold_pace_s_per_km": 300, "run.lthr_bpm": 180, "general.max_hr_bpm": 195 }, settings);
    const updates = alignmentUpdates(rows);
    expect(updates).toHaveLength(2);
    const ride = updates.find((u) => u.settingsId === "11")!;
    expect(ride).toMatchObject({ patch: { ftp: 240 }, recalcHrZones: false, rows: ["Ride.ftp"] });
    const run = updates.find((u) => u.settingsId === "12")!;
    expect(run.patch.lthr).toBe(180);
    expect(run.patch.threshold_pace).toBeCloseTo(1000 / 300, 6);
    // La FC seuil change : intervals.icu recalcule ses zones de FC.
    expect(run.recalcHrZones).toBe(true);
    // Rien de TriCoach pour la natation : rien n'est envoyé, rien n'est effacé chez intervals.icu.
    expect(updates.some((u) => u.settingsId === "13")).toBe(false);
  });

  it("sans réglage pour un sport chez intervals.icu, rien à mettre à jour", () => {
    const rows = compareThresholds({ "swim.css_s_per_100m": 95 }, settings.slice(0, 2));
    expect(rows.find((r) => r.id === "Swim.threshold_pace")).toMatchObject({ settingsId: null, intervals: null, same: false });
    expect(alignmentUpdates(rows)).toEqual([]);
  });

  it("vérifie la réponse d'intervals.icu après l'envoi", () => {
    const update = { settingsId: "12", patch: { lthr: 180, threshold_pace: 1000 / 300 }, recalcHrZones: true, rows: [] };
    expect(appliedAsSent(update, { ...settings[1], lthr: 180, thresholdPaceMps: 3.333 })).toBe(true);
    expect(appliedAsSent(update, settings[1])).toBe(false);
  });
});
