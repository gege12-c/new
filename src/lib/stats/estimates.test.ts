import { describe, expect, it } from "vitest";
import { estimateFtp, estimateThresholdPace } from "./estimates";
import { paceCurve, powerCurve } from "./power";

const today = "2026-10-31";

describe("seuils estimés d'après les records", () => {
  it("FTP : 95 % des 20 min, ou les 60 min si elles sont plus hautes ; sur 3 mois seulement", () => {
    const twenty = powerCurve([{ activityId: "a", date: "2026-10-12", bests: { "1200": 276, "3600": 240 } }], today);
    expect(estimateFtp(twenty)).toEqual({ watts: 262, basis: { duration: 1200, watts: 276, date: "2026-10-12", activityId: "a" } });
    const hour = powerCurve([{ activityId: "b", date: "2026-10-01", bests: { "1200": 270, "3600": 260 } }], today);
    expect(estimateFtp(hour)).toMatchObject({ watts: 260, basis: { duration: 3600 } });
    // Record de plus de 3 mois : pas d'estimation (la forme a pu changer).
    expect(estimateFtp(powerCurve([{ activityId: "c", date: "2026-06-01", bests: { "1200": 300 } }], today))).toBeNull();
    expect(estimateFtp(powerCurve([], today))).toBeNull();
  });

  it("allure seuil : l'effort le plus proche d'une heure, ramené à une heure (Riegel)", () => {
    // 10 km en 45 min : environ 4:34 /km tenus une heure.
    const curve = paceCurve([{ activityId: "a", date: "2026-10-05", sport: "run", pace: { "1000": 230, "5000": 1250, "10000": 2700 } }], "run", today);
    const estimate = estimateThresholdPace(curve)!;
    expect(estimate.basis).toEqual({ distance: 10000, seconds: 2700, date: "2026-10-05", activityId: "a" });
    expect(estimate.secondsPerKm).toBeGreaterThanOrEqual(273);
    expect(estimate.secondsPerKm).toBeLessThanOrEqual(276);
    // Rien entre 15 et 75 min : pas d'estimation (un 1 km ne dit rien de l'allure d'une heure).
    expect(estimateThresholdPace(paceCurve([{ activityId: "b", date: "2026-10-05", sport: "run", pace: { "1000": 230 } }], "run", today))).toBeNull();
  });
});
