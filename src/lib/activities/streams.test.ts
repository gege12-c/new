import { describe, expect, it } from "vitest";
import { activityMetrics, availableMetrics, intervalsLaps, intervalsStreams, minettiCost, powerBests, readStoredStreams, reduceStreams, STREAM_MAX_POINTS } from "./streams";

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

  it("intervalles qui se chevauchent (kilomètres mêlés aux étapes) : plus aucun chevauchement", () => {
    const interval = (start: number, elapsed: number, distance: number) => ({ type: "WORK", start_time: start, elapsed_time: elapsed, distance });
    // Course du 31 octobre : kilomètres 1 et 3, fin d'échauffement, fractions et récupérations de 20 s,
    // et un intervalle de 48 s qui en recouvre un autre.
    const laps = intervalsLaps({
      icu_intervals: [
        interval(0, 349, 1000),
        interval(349, 552, 1534),
        interval(706, 342, 1000),
        ...[922, 942, 962, 982, 1002, 1023, 1043].map((start) => interval(start, 20, 60)),
        interval(1063, 48, 136),
        interval(1083, 20, 50),
        interval(1083, 20, 50),
      ],
    });
    expect(laps.map((l) => [l.start_s, l.duration_s])).toEqual([
      [0, 349],
      [349, 552],
      [922, 20],
      [942, 20],
      [962, 20],
      [982, 20],
      [1002, 20],
      [1023, 20],
      [1043, 20],
      [1083, 20],
    ]);
    // Un intervalle qui en regroupe plusieurs est retiré ; le reste est gardé tel quel.
    const group = [interval(0, 600, 1700), interval(0, 300, 850), interval(300, 300, 850)];
    expect(intervalsLaps({ icu_intervals: group }).map((l) => l.duration_s)).toEqual([300, 300]);
    // Lu en base : nettoyé aussi.
    const row = { sample_s: 5, series: { time: [0, 5] }, laps: intervalsLaps({ icu_intervals: [interval(0, 300, 850), interval(300, 300, 850)] }), laps_origin: "detected", bests: {} };
    expect(readStoredStreams({ ...row, laps: [...row.laps, { ...row.laps[0], start_s: 100, duration_s: 1000, distance_m: 3000 }] })!.laps).toHaveLength(2);
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

describe("mesures normalisées", () => {
  const hour = seconds(3600);

  it("puissance normalisée : égale à la moyenne quand la puissance est constante, au-dessus en fractionné", () => {
    expect(activityMetrics({ time: hour, watts: hour.map(() => 200) }, "bike").np).toBe(200);
    const intervals = activityMetrics({ time: hour, watts: hour.map((t) => (Math.floor(t / 60) % 2 ? 100 : 300)) }, "bike");
    expect(intervals.np).toBeGreaterThan(220);
    expect(intervals.np).toBeLessThan(300);
    // Moins de dix minutes : la moyenne suffit, rien n'est calculé.
    expect(activityMetrics({ time: seconds(300), watts: seconds(300).map(() => 250) }, "bike")).toEqual({});
  });

  it("course : vitesse normalisée ajustée à la pente (Minetti) ; à plat, la vitesse elle-même", () => {
    const flat = activityMetrics({ time: hour, speed: hour.map(() => 3.5), altitude: hour.map(() => 200), distance: hour.map((t) => t * 3.5) }, "run");
    expect(flat.ngs).toBeCloseTo(3.5, 2);
    const climb = activityMetrics({ time: hour, speed: hour.map(() => 3), altitude: hour.map((t) => 200 + t * 3 * 0.05), distance: hour.map((t) => t * 3) }, "run");
    expect(climb.ngs).toBeCloseTo((3 * minettiCost(0.05)) / minettiCost(0), 2);
    expect(minettiCost(0)).toBe(3.6);
    // Arrêts exclus ; sans altitude, pas d'ajustement ; à vélo, pas d'allure de course.
    expect(activityMetrics({ time: hour, speed: hour.map((t) => (t < 600 ? 0 : 3)) }, "run").ngs).toBeCloseTo(3, 2);
    expect(activityMetrics({ time: hour, speed: hour.map(() => 9) }, "bike").ngs).toBeUndefined();
  });

  it("fréquence cardiaque quadratique moyenne : les passages intenses pèsent plus que dans la moyenne", () => {
    expect(activityMetrics({ time: hour, heartrate: hour.map(() => 150) }, "run").hr_rms).toBe(150);
    expect(activityMetrics({ time: hour, heartrate: hour.map((t) => (t % 2 ? 180 : 120)) }, "run").hr_rms).toBeCloseTo(Math.sqrt((180 ** 2 + 120 ** 2) / 2), 1);
  });
});
