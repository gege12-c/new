import { describe, expect, it } from "vitest";
import { bikeThreshold, brick, swimCss } from "@/lib/workout/fixtures";
import { WorkoutSchema, type WorkoutInput } from "@/lib/workout/schema";
import { adherence, bandOf, fitRecords, intensityDistribution, lastWeeks, thresholdSeries, weeklyVolumes, type StatActivity, type StatSession } from "./stats";

const thresholds = () => ({ bike: { ftpW: 250 }, run: { thresholdPaceSPerKm: 250 }, swim: { cssSPer100m: 100 } });
let n = 0;
const session = (date: string, input: WorkoutInput, state = "published"): StatSession => ({
  id: `s${++n}`,
  scheduled_date: date,
  state,
  sport: "bike",
  planned_duration_s: null,
  content: WorkoutSchema.parse(input),
});
const activity = (date: string, sport: string, moving: number, extra: Partial<StatActivity> = {}): StatActivity => ({
  sport,
  local_date: date,
  moving_s: moving,
  elapsed_s: moving,
  distance_m: null,
  avg_power: null,
  avg_speed_mps: null,
  ...extra,
});

describe("volumes par semaine", () => {
  it("12 semaines, du lundi le plus ancien à la semaine en cours", () => {
    const weeks = lastWeeks("2026-10-21", 12);
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toBe("2026-10-19");
    expect(weeks[0]).toBe("2026-08-03");
  });

  it("prévu par discipline (enchaînement découpé), réalisé d'après les fichiers FIT seulement", () => {
    const weeks = lastWeeks("2026-10-21", 2);
    const sessions = [
      session("2026-10-19", bikeThreshold),
      session("2026-10-20", brick),
      session("2026-10-21", bikeThreshold, "draft"),
      session("2026-10-22", bikeThreshold, "cancelled"),
      session("2026-10-12", swimCss),
    ];
    const volumes = weeklyVolumes(weeks, sessions, [activity("2026-10-19", "bike", 4000), activity("2026-10-14", "swim", 2400)], thresholds);
    const current = volumes[1];
    // Seuil 4 × 8 : 69 min ; enchaînement : 60 min de vélo, 22 min de course (transition comprise).
    expect(current.planned.bike).toBe(4140 + 3600);
    expect(current.planned.run).toBe(1320);
    expect(current.plannedTotal).toBe(4140 + 3600 + 1320);
    expect(current.realized).toMatchObject({ bike: 4000, run: 0 });
    expect(volumes[0].planned.swim).toBeGreaterThan(0);
    expect(volumes[0].realizedTotal).toBe(2400);
  });

  it("signale les séances dont la durée n'est pas calculable, sans les compter à zéro", () => {
    const open: WorkoutInput = { schemaVersion: 1, segments: [{ id: "a", sport: "run", steps: [{ kind: "step", id: "x", type: "active", length: { unit: "open" } }] }] };
    const [week] = weeklyVolumes(lastWeeks("2026-10-21", 1), [session("2026-10-20", open)], [], thresholds);
    expect(week).toMatchObject({ plannedTotal: 0, incomplete: 1 });
  });
});

describe("répartition de l'intensité prévue", () => {
  it("classe chaque étape par bande, met à part le temps sans cible", () => {
    const dist = intensityDistribution([session("2026-10-19", bikeThreshold), session("2026-10-20", swimCss)], "2026-10-01", "2026-10-31", thresholds);
    expect(bandOf(50)).toBe("z1");
    expect(bandOf(97.5)).toBe("z4");
    // Vélo : 15 min à 62,5 % (Z2), 4 × 8 min à 97,5 % (Z4), 4 × 3 min en Z1, 10 min à 55 % (Z1).
    // Natation : 8 × 100 m à 100 % de la CSS, départ toutes les 1:50 (Z4).
    expect(dist.seconds.z4).toBe(4 * 480 + 8 * 110);
    expect(dist.seconds.z2).toBe(900);
    expect(dist.seconds.z1).toBe(4 * 180 + 600);
    // Natation : échauffement et pull-buoy sans cible.
    expect(dist.unclassified).toBeGreaterThan(0);
    expect(dist.sessions).toBe(2);
  });
});

describe("suivi des séances passées", () => {
  it("retour de l'athlète d'abord, puis fichier FIT ; jamais Strava", () => {
    const list = [session("2026-10-12", bikeThreshold), session("2026-10-13", bikeThreshold), session("2026-10-14", bikeThreshold), session("2026-10-15", bikeThreshold), session("2026-10-25", bikeThreshold)];
    const result = adherence(list, new Map([[list[0].id, "done"], [list[1].id, "skipped"]]), new Set([list[2].id]), "2026-10-01", "2026-10-21");
    expect(result).toEqual({ total: 4, counts: { done: 1, partial: 0, skipped: 1, fit: 1, none: 1 } });
  });
});

describe("seuils et records", () => {
  it("historique trié de chaque seuil", () => {
    const series = thresholdSeries(
      [
        { sport: "bike", metric: "ftp_w", value: "260", effective_from: "2026-09-01" },
        { sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-06-01" },
        { sport: "run", metric: "lthr_bpm", value: 170, effective_from: "2026-06-01" },
      ],
      ["bike.ftp_w", "swim.css_s_per_100m"],
    );
    expect(series[0].points).toEqual([
      { date: "2026-06-01", value: 250 },
      { date: "2026-09-01", value: 260 },
    ]);
    expect(series[1].points).toEqual([]);
  });

  it("records des fichiers FIT, avec des seuils de durée et de distance", () => {
    const records = fitRecords([
      activity("2026-10-01", "bike", 3600, { avg_power: 210, distance_m: 32000 }),
      activity("2026-10-05", "bike", 900, { avg_power: 300 }),
      activity("2026-10-02", "run", 1800, { distance_m: 6000, avg_speed_mps: 1000 / 270 }),
      activity("2026-10-03", "run", 900, { distance_m: 3000, avg_speed_mps: 1000 / 240 }),
    ]);
    const byKey = Object.fromEntries(records.map((r) => [r.key, r]));
    expect(byKey["bike.power"]).toMatchObject({ value: 210, date: "2026-10-01" });
    expect(byKey["run.pace"].value).toBeCloseTo(270);
    expect(byKey["bike.duration"].value).toBe(3600);
    expect(byKey["swim.duration"]).toBeUndefined();
    expect(fitRecords([])).toEqual([]);
  });
});
