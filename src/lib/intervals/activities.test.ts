import { describe, expect, it } from "vitest";
import { normalizeIntervalsActivity, sameActivity, zonedLocalToUtc } from "./activities";

const ride = {
  id: "i55751783",
  start_date_local: "2026-11-02T07:35:18",
  start_date: "2026-11-02T06:35:18Z",
  type: "VirtualRide",
  name: "Seuil 4 × 8 min",
  source: "SUUNTO",
  file_type: "fit",
  moving_time: 3540,
  elapsed_time: 3600,
  distance: 31_250.4,
  total_elevation_gain: 120,
  average_heartrate: 148.6,
  max_heartrate: 176,
  icu_average_watts: 212,
  icu_weighted_avg_watts: 228,
  max_watts: 512,
  average_cadence: 88.4,
  average_speed: 8.83,
  trainer: true,
  device_name: "Suunto Race S",
  icu_training_load: 74,
};

describe("activités reçues d'intervals.icu", () => {
  it("résumé normalisé : instant UTC, date et heure locales, mesures bornées", () => {
    const outcome = normalizeIntervalsActivity(ride, "Europe/Paris");
    expect(outcome).toEqual({
      kind: "activity",
      // Charge calculée par intervals.icu : reprise telle quelle par la courbe de condition.
      sourceLoad: 74,
      fields: {
        external_id: "i55751783",
        group_key: null,
        sport: "bike",
        sport_detail: "VirtualRide",
        name: "Seuil 4 × 8 min",
        start_time: "2026-11-02T06:35:18.000Z",
        local_date: "2026-11-02",
        local_start_time: "07:35:18",
        timezone: "Europe/Paris",
        elapsed_s: 3600,
        moving_s: 3540,
        distance_m: 31250.4,
        elevation_gain_m: 120,
        avg_hr: 149,
        max_hr: 176,
        avg_power: 212,
        weighted_power: 228,
        max_power: 512,
        avg_cadence: 88,
        avg_speed_mps: 8.83,
        trainer: true,
        manual: false,
        device_name: "Suunto Race S",
      },
    });
  });

  it("activité reçue de Strava par intervals.icu : non transmise, signalée sans être devinée", () => {
    expect(normalizeIntervalsActivity({ id: "i1", start_date_local: "2026-11-02T07:00:00", type: "Run", source: "STRAVA", _note: "STRAVA activities are not available via the API" }, "Europe/Paris")).toEqual({ kind: "strava" });
  });

  it("disciplines : natation en eau libre, renforcement, autre", () => {
    const sport = (type: string) => {
      const outcome = normalizeIntervalsActivity({ ...ride, type }, "Europe/Paris");
      return outcome.kind === "activity" ? outcome.fields.sport : null;
    };
    expect(["Ride", "GravelRide", "Run", "TrailRun", "Swim", "OpenWaterSwim", "WeightTraining", "Yoga"].map(sport)).toEqual([
      "bike",
      "bike",
      "run",
      "run",
      "swim",
      "swim",
      "strength",
      "other",
    ]);
  });

  it("sans instant UTC : calculé depuis l'heure locale et le fuseau (heure d'été comprise)", () => {
    expect(zonedLocalToUtc("2026-07-01T07:00:00", "Europe/Paris").toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(zonedLocalToUtc("2026-12-01T07:00:00", "Europe/Paris").toISOString()).toBe("2026-12-01T06:00:00.000Z");
    const outcome = normalizeIntervalsActivity({ ...ride, start_date: null, timezone: "America/New_York", start_date_local: "2026-11-02T07:35" }, "Europe/Paris");
    expect(outcome.kind === "activity" && [outcome.fields.start_time, outcome.fields.local_start_time, outcome.fields.timezone]).toEqual([
      "2026-11-02T12:35:00.000Z",
      "07:35:00",
      "America/New_York",
    ]);
  });

  it("valeurs aberrantes écartées, activité illisible ignorée", () => {
    const outcome = normalizeIntervalsActivity({ ...ride, average_heartrate: 400, max_watts: "beaucoup" }, "Europe/Paris");
    expect(outcome.kind === "activity" && [outcome.fields.avg_hr, outcome.fields.max_power]).toEqual([null, null]);
    expect(normalizeIntervalsActivity({ id: "i2", type: "Ride" }, "Europe/Paris")).toEqual({ kind: "unreadable" });
    expect(normalizeIntervalsActivity("pas une activité", "Europe/Paris")).toEqual({ kind: "unreadable" });
  });

  it("comparaison avec la ligne enregistrée, aux formats de la base près", () => {
    const outcome = normalizeIntervalsActivity(ride, "Europe/Paris");
    if (outcome.kind !== "activity") throw new Error("activité attendue");
    const stored = { ...outcome.fields, start_time: "2026-11-02T06:35:18+00:00", local_start_time: "07:35:18", distance_m: "31250.4" };
    expect(sameActivity(stored, outcome.fields)).toBe(true);
    expect(sameActivity({ ...stored, name: "Renommée" }, outcome.fields)).toBe(false);
    expect(sameActivity({ ...stored, avg_hr: null }, outcome.fields)).toBe(false);
  });
});
