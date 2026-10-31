import { describe, expect, it } from "vitest";
import { missingMeasures, morningMeasures } from "./wellness";

describe("mesures du matin reçues d'intervals.icu", () => {
  it("lit FC au repos, VFC, sommeil et poids, bornés ; ignore les jours vides ou illisibles", () => {
    expect(
      morningMeasures([
        { id: "2026-11-01", restingHR: 47.6, hrv: 62.2, sleepSecs: 27_000, weight: 72.46, ctl: 50 },
        { id: "2026-11-02", restingHR: null, hrv: null, ctl: 51 },
        { id: "2026-11-03", restingHR: 400, sleepSecs: 30_600 },
        { id: "pas-une-date", restingHR: 50 },
      ]),
    ).toEqual([
      { entry_date: "2026-11-01", resting_hr: 48, hrv_ms: 62, sleep_hours: 7.5, weight_kg: 72.5 },
      { entry_date: "2026-11-03", resting_hr: null, hrv_ms: null, sleep_hours: 8.5, weight_kg: null },
    ]);
  });

  it("ne complète que les champs vides : une valeur saisie par l'athlète reste", () => {
    const upstream = { entry_date: "2026-11-01", resting_hr: 48, hrv_ms: 62, sleep_hours: 7.5, weight_kg: null };
    expect(missingMeasures(upstream, undefined)).toEqual({ resting_hr: 48, hrv_ms: 62, sleep_hours: 7.5 });
    expect(missingMeasures(upstream, { entry_date: "2026-11-01", resting_hr: 51, hrv_ms: null, sleep_hours: "6.0", weight_kg: null })).toEqual({ hrv_ms: 62 });
    expect(missingMeasures(upstream, { entry_date: "2026-11-01", resting_hr: 51, hrv_ms: 70, sleep_hours: 6, weight_kg: null })).toBeNull();
  });
});
