import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/planning/dates";
import { WorkoutSchema, type Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import {
  activityLoad,
  dailyLoads,
  feedbackLoad,
  fitnessSeries,
  formZone,
  plannedLoad,
  tss,
  type FitnessCompletion,
  type FitnessSession,
  type LoadActivity,
} from "./fitness";

const thresholds: AthleteThresholds = { bike: { ftpW: 250, lthrBpm: 160 }, run: { thresholdPaceSPerKm: 240 }, swim: { cssSPer100m: 100 } };
const at = () => thresholds;

const activity = (overrides: Partial<LoadActivity>): LoadActivity => ({
  id: "a",
  sport: "bike",
  local_date: "2026-10-10",
  moving_s: 3600,
  elapsed_s: 3700,
  avg_power: null,
  weighted_power: null,
  avg_hr: null,
  avg_speed_mps: null,
  ...overrides,
});

const workout = (seconds: number, percent: number): Workout =>
  WorkoutSchema.parse({
    schemaVersion: 1,
    segments: [
      {
        id: "s",
        sport: "bike",
        steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds }, targets: [{ metric: "power", unit: "percent_ftp", min: percent, max: percent }] }],
      },
    ],
  });

describe("charge d'entraînement", () => {
  it("une heure au seuil vaut 100, quelle que soit la mesure", () => {
    expect(tss(3600, 1)).toBe(100);
    expect(activityLoad(activity({ weighted_power: 250 }), thresholds)).toEqual({ load: 100, method: "power", estimated: false });
    expect(activityLoad(activity({ sport: "run", avg_speed_mps: 1000 / 240 }), thresholds)?.load).toBeCloseTo(100);
    expect(activityLoad(activity({ sport: "swim", avg_speed_mps: 1 }), thresholds)?.load).toBeCloseTo(100);
    expect(activityLoad(activity({ avg_hr: 160 }), { bike: { lthrBpm: 160 } })).toMatchObject({ load: 100, method: "heart_rate", estimated: true });
  });

  it("puissance moyenne faute de normalisée : estimée ; rien d'exploitable : non comptée", () => {
    expect(activityLoad(activity({ avg_power: 200 }), thresholds)).toMatchObject({ method: "power", estimated: true });
    expect(activityLoad(activity({ weighted_power: 250 }), {})).toBeNull();
    expect(activityLoad(activity({ moving_s: null, elapsed_s: null, weighted_power: 250 }), thresholds)).toBeNull();
  });

  it("prévue : étape par étape ; une étape sans intensité n'est pas comptée", () => {
    expect(plannedLoad(workout(3600, 100), thresholds)).toEqual({ load: 100, unknownSeconds: 0, seconds: 3600 });
    const half = workout(3600, 70);
    expect(plannedLoad(half, thresholds).load).toBeCloseTo(49);
    const unknown = WorkoutSchema.parse({
      schemaVersion: 1,
      segments: [{ id: "s", sport: "bike", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 1800 }, targets: [] }] }],
    });
    expect(plannedLoad(unknown, thresholds)).toEqual({ load: 0, unknownSeconds: 1800, seconds: 1800 });
  });

  it("ressenti : une heure à RPE 7–8 vaut presque une heure au seuil", () => {
    expect(feedbackLoad(3600, 7.5)).toBeGreaterThan(90);
    expect(feedbackLoad(3600, 7.5)).toBeLessThan(105);
    expect(feedbackLoad(3600, 3)).toBeLessThan(45);
  });
});

describe("condition, fatigue et forme", () => {
  it("une charge constante fait monter la condition lentement, la fatigue vite", () => {
    const start = "2026-01-01";
    const actual = new Map(Array.from({ length: 42 }, (_, i) => [addDays(start, i), 100] as const));
    const points = fitnessSeries(actual, new Map(), start, addDays(start, 41), addDays(start, 60));
    const last = points[points.length - 1];
    expect(last.fatigue).toBeGreaterThan(99);
    expect(last.fitness).toBeCloseTo(100 * (1 - (41 / 42) ** 42), 5);
    expect(last.form).toBeCloseTo(last.fitness - last.fatigue);
    expect(points.every((p) => !p.projected)).toBe(true);
  });

  it("au-delà d'aujourd'hui, la prévision suit les séances prévues", () => {
    const today = "2026-10-19";
    const planned = new Map([["2026-10-20", 80]]);
    const points = fitnessSeries(new Map([["2026-10-18", 120]]), planned, "2026-10-17", "2026-10-21", today);
    expect(points.map((p) => [p.date, p.load, p.projected])).toEqual([
      ["2026-10-17", 0, false],
      ["2026-10-18", 120, false],
      ["2026-10-19", 0, true],
      ["2026-10-20", 80, true],
      ["2026-10-21", 0, true],
    ]);
  });

  it("zones de forme", () => {
    expect(formZone(25).key).toBe("transition");
    expect(formZone(10).key).toBe("fresh");
    expect(formZone(-6).key).toBe("grey");
    expect(formZone(-20).key).toBe("optimal");
    expect(formZone(-40).key).toBe("risk");
  });
});

describe("charges du jour", () => {
  const today = "2026-10-19";
  const session = (id: string, date: string, percent = 100): FitnessSession => ({ id, scheduled_date: date, state: "published", content: workout(3600, percent) });
  const completion = (id: string, status: FitnessCompletion["status"], rpe: number | null = null): [string, FitnessCompletion] => [id, { session_id: id, status, rpe }];

  it("fichier FIT, retour de séance, prévision ; jamais deux fois la même séance", () => {
    const sessions = [session("fit", "2026-10-15"), session("rpe", "2026-10-16"), session("plan", "2026-10-17"), session("todo", "2026-10-21", 70), session("draft", "2026-10-22")];
    sessions[4].state = "draft";
    const { actual, planned, coverage } = dailyLoads({
      today,
      sessions,
      activities: [activity({ id: "f1", local_date: "2026-10-15", weighted_power: 250 })],
      matches: new Map([["f1", "fit"]]),
      completions: new Map([completion("fit", "done", 9), completion("rpe", "done", 7.5), completion("plan", "done")]),
      thresholdsOn: at,
    });
    expect(actual.get("2026-10-15")).toBe(100);
    expect(actual.get("2026-10-16")).toBeCloseTo(feedbackLoad(3600, 7.5));
    expect(actual.get("2026-10-17")).toBe(100);
    expect(planned.get("2026-10-21")).toBeCloseTo(49);
    expect(planned.has("2026-10-22")).toBe(false);
    expect(coverage).toMatchObject({ fit: 1, feedback: 2, planned: 1, fitWithoutMeasure: 0, feedbackWithoutMeasure: 0 });
  });

  it("« en partie » ou sans mesure : rien n'est supposé, et c'est compté comme manquant", () => {
    const { actual, coverage } = dailyLoads({
      today,
      sessions: [session("partial", "2026-10-16")],
      activities: [activity({ id: "f2", local_date: "2026-10-14" })],
      matches: new Map(),
      completions: new Map([completion("partial", "partial", 6)]),
      thresholdsOn: at,
    });
    expect(actual.size).toBe(0);
    expect(coverage).toMatchObject({ fitWithoutMeasure: 1, feedbackWithoutMeasure: 1 });
  });
});
