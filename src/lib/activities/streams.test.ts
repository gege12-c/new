import { describe, expect, it } from "vitest";
import { availableMetrics, intervalsLaps, intervalsStreams, powerBests, readStoredStreams, reduceStreams, STREAM_MAX_POINTS } from "./streams";

const seconds = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("réduction des courbes", () => {
  it("moyenne par tranche, un point par tranche de quelques secondes, au plus STREAM_MAX_POINTS", () => {
    const time = seconds(3600);
    const watts = time.map((t) => (t < 1800 ? 200 : 300));
    const reduced = reduceStreams({ time, watts, heartrate: time.map(() => 150) })!;
    expect(reduced.sample_s).toBe(5);
    expect(reduced.series.time.length).toBe(720);
    expect(reduced.series.time.slice(0, 3)).toEqual([0, 5, 10]);
    expect(reduced.series.watts![0]).toBe(200);
    expect(reduced.series.watts![719]).toBe(300);
    expect(reduceStreams({ time: seconds(3601), watts: seconds(3601) })!.sample_s).toBe(6);
    expect(reduced.series.heartrate!.every((v) => v === 150)).toBe(true);
    expect(reduced.series.time.length).toBeLessThanOrEqual(STREAM_MAX_POINTS);
  });

  it("une pause reste un trou ; une mesure hors bornes est ignorée ; une courbe vide est omise", () => {
    const time = [...seconds(30), ...seconds(30).map((t) => t + 100)];
    const watts = time.map((t, i) => (i === 2 ? 9999 : t < 100 ? 100 : 200));
    const reduced = reduceStreams({ time, watts, cadence: time.map(() => null), heartrate: time.map((_, i) => (i < 2 ? 130 : null)) }, 50)!;
    expect(reduced.sample_s).toBe(3);
    expect(reduced.series.watts![0]).toBe(100);
    expect(reduced.series.watts![10]).toBeNull();
    expect(reduced.series.watts![40]).toBe(200);
    expect(reduced.series.cadence).toBeUndefined();
    // Deux mesures éparses ne font pas une courbe.
    expect(reduced.series.heartrate).toBeUndefined();
    expect(availableMetrics(reduced.series)).toEqual(["watts"]);
  });

  it("distance : la plus grande valeur de la tranche ; sans temps, une mesure par seconde", () => {
    const reduced = reduceStreams({ distance: [0, 3, 6, 9, 12, 15], speed: [3, 3, 3, 3, 3, 3] }, 3)!;
    expect(reduced.sample_s).toBe(2);
    expect(reduced.series.distance).toEqual([3, 9, 15]);
    expect(reduced.series.speed).toEqual([3, 3, 3]);
  });

  it("rien à tracer : null (temps incohérent, aucune mesure, un seul point)", () => {
    expect(reduceStreams({ time: [0, 5, 3], watts: [1, 2, 3] })).toBeNull();
    expect(reduceStreams({ time: [0, 1, 2] })).toBeNull();
    expect(reduceStreams({ watts: [250] })).toBeNull();
    expect(reduceStreams({})).toBeNull();
  });
});

describe("meilleures puissances", () => {
  it("moyennes glissantes sur 5 s, 1 min, 5 min, 20 min et 60 min", () => {
    const time = seconds(3700);
    const watts = time.map((t) => (t >= 600 && t < 900 ? 400 : t >= 1000 && t < 1005 ? 900 : 200));
    const bests = powerBests({ time, watts });
    expect(bests["5"]).toBe(900);
    expect(bests["60"]).toBe(400);
    expect(bests["300"]).toBe(400);
    expect(bests["1200"]).toBe(Math.round((300 * 400 + 5 * 900 + 895 * 200) / 1200));
    expect(bests["3600"]).toBeGreaterThan(200);
  });

  it("une mesure tient jusqu'à la suivante (5 s au plus) ; au-delà, la pause compte à 0 W ; trop court : rien", () => {
    // Une mesure toutes les 2 s (enregistrement « intelligent »).
    const time = seconds(200).map((i) => i * 2);
    expect(powerBests({ time, watts: time.map(() => 250) })["60"]).toBe(250);
    const paused = powerBests({ time: [0, 1, 2, 3, 4, 70, 71, 72, 73, 74], watts: [300, 300, 300, 300, 300, 300, 300, 300, 300, 300] });
    expect(paused["5"]).toBe(300);
    expect(paused["60"]).toBe(Math.round((5 * 300) / 60));
    expect(powerBests({ time: seconds(30), watts: seconds(30).map(() => 300) })).toEqual({ "5": 300 });
    expect(powerBests({ time: seconds(30), heartrate: seconds(30).map(() => 140) })).toEqual({});
  });
});

describe("intervals.icu", () => {
  it("courbes : liste { type, data }, noms d'intervals.icu traduits, types inconnus ignorés", () => {
    const raw = intervalsStreams([
      { type: "time", data: [0, 1, 2] },
      { type: "watts", data: [200, null, 210] },
      { type: "velocity_smooth", data: [8.1, 8.2, 8.3] },
      { type: "latlng", data: [45.1, 45.2, 45.3], data2: [5.1, 5.2, 5.3] },
      { type: "heartrate", data: "abc" },
    ]);
    expect(raw).toEqual({ time: [0, 1, 2], watts: [200, null, 210], speed: [8.1, 8.2, 8.3] });
  });

  it("courbes rangées par nom, réponse vide ou illisible", () => {
    expect(intervalsStreams({ heartrate: [120, 121], cadence: [80, "x"] })).toEqual({ heartrate: [120, 121], cadence: [80, null] });
    expect(intervalsStreams(null)).toEqual({});
    expect(intervalsStreams("oops")).toEqual({});
  });

  it("intervalles détectés : efforts et récupérations, bornes contrôlées, triés", () => {
    const laps = intervalsLaps({
      id: "i1",
      icu_intervals: [
        { type: "RECOVERY", start_time: 780, end_time: 960, elapsed_time: 180, average_watts: 140, average_heartrate: 128 },
        { type: "WORK", label: "Seuil", start_time: 300, end_time: 780, elapsed_time: 480, distance: 4100.4, average_watts: 251.6, average_heartrate: 161.2, max_heartrate: 170, average_cadence: 88, average_speed: 8.53456 },
        { type: "WORK", start_time: -5, elapsed_time: 10 },
        "not an interval",
      ],
    });
    expect(laps).toEqual([
      { start_s: 300, duration_s: 480, distance_m: 4100, avg_power: 252, avg_hr: 161, max_hr: 170, avg_cadence: 88, avg_speed_mps: 8.535, kind: "work", label: "Seuil" },
      { start_s: 780, duration_s: 180, distance_m: null, avg_power: 140, avg_hr: 128, max_hr: null, avg_cadence: null, avg_speed_mps: null, kind: "recovery", label: null },
    ]);
    expect(intervalsLaps({ icu_intervals: [{ start_index: 10, end_index: 70 }] })[0]).toMatchObject({ start_s: 10, duration_s: 60, kind: null });
    expect(intervalsLaps(undefined)).toEqual([]);
  });
});

describe("lecture en base", () => {
  it("courbes valides lues, illisibles écartées", () => {
    const row = { sample_s: 5, series: { time: [0, 5], watts: [200, null] }, laps: [], laps_origin: null, bests: { "5": 310 } };
    expect(readStoredStreams(row)).toEqual(row);
    expect(readStoredStreams({ ...row, series: { time: [0, 5], watts: [200] } })).toBeNull();
    expect(readStoredStreams({ ...row, sample_s: 0 })).toBeNull();
    expect(readStoredStreams(null)).toBeNull();
  });
});
