import { describe, expect, it } from "vitest";
import { paceCurve, powerCurve } from "./power";

describe("meilleures puissances par période", () => {
  it("la meilleure moyenne de chaque durée, par période, avec sa date", () => {
    const curve = powerCurve(
      [
        { activityId: "a", date: "2026-10-28", bests: { "5": 700, "60": 380, "300": 300, "1200": 262 } },
        { activityId: "b", date: "2026-08-20", bests: { "5": 820, "60": 410, "300": 318, "1200": 270, "3600": 241 } },
        { activityId: "c", date: "2026-01-15", bests: { "5": 900, "1200": 290 } },
        // Hors des 12 mois, sans puissance, illisible, à venir : ignorées.
        { activityId: "d", date: "2025-09-01", bests: { "5": 1200 } },
        { activityId: "e", date: "2026-10-01", bests: {} },
        { activityId: "f", date: "2026-10-02", bests: "oops" },
        { activityId: "g", date: "2026-11-02", bests: { "5": 1500 } },
      ],
      "2026-10-31",
    );
    expect(curve.activities).toBe(3);
    expect(curve.bests[5]).toEqual({
      "42": { watts: 700, date: "2026-10-28", activityId: "a" },
      "90": { watts: 820, date: "2026-08-20", activityId: "b" },
      "365": { watts: 900, date: "2026-01-15", activityId: "c" },
    });
    expect(curve.bests[3600]).toEqual({ "90": { watts: 241, date: "2026-08-20", activityId: "b" }, "365": { watts: 241, date: "2026-08-20", activityId: "b" } });
    expect(curve.bests[1200]["365"]).toMatchObject({ watts: 290, activityId: "c" });
  });

  it("aucune activité avec puissance : courbe vide", () => {
    const curve = powerCurve([], "2026-10-31");
    expect(curve.activities).toBe(0);
    expect(curve.bests[60]).toEqual({});
  });
});

describe("meilleurs temps par distance et par période", () => {
  it("le plus court de chaque distance, par sport et par période, avec sa date", () => {
    const curve = paceCurve(
      [
        { activityId: "a", date: "2026-10-20", sport: "run", pace: { "1000": 230, "5000": 1250 } },
        { activityId: "b", date: "2026-07-01", sport: "run", pace: { "1000": 222, "10000": 2700 } },
        { activityId: "c", date: "2026-10-21", sport: "swim", pace: { "400": 330 } },
        // Illisible, vide, trop ancien : ignorés.
        { activityId: "d", date: "2026-10-22", sport: "run", pace: "oops" },
        { activityId: "e", date: "2026-10-23", sport: "run", pace: {} },
        { activityId: "f", date: "2025-06-01", sport: "run", pace: { "1000": 200 } },
      ],
      "run",
      "2026-10-31",
    );
    expect(curve.activities).toBe(2);
    expect(curve.bests[1000]).toEqual({
      "42": { seconds: 230, date: "2026-10-20", activityId: "a" },
      "90": { seconds: 230, date: "2026-10-20", activityId: "a" },
      "365": { seconds: 222, date: "2026-07-01", activityId: "b" },
    });
    expect(curve.bests[10000]).toEqual({ "365": { seconds: 2700, date: "2026-07-01", activityId: "b" } });
    expect(paceCurve([], "swim", "2026-10-31").activities).toBe(0);
  });
});
