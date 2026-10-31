import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/planning/dates";
import { WorkoutSchema, type Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import {
  activityLoad,
  dailyLoads,
  dropDuplicateRecordings,
  feedbackLoad,
  fitnessSeries,
  formOnRaceMorning,
  formZone,
  heartIntensity,
  medianRestingHr,
  plannedLoad,
  PUBLISHED_PLAN,
  simulate,
  tss,
  weeklyRamp,
  type FitnessCompletion,
  type FitnessModel,
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

  it("courbe seconde par seconde : puissance normalisée, allure ajustée à la pente, FC quadratique", () => {
    expect(activityLoad(activity({ avg_power: 180, np: 250 }), thresholds)).toEqual({ load: 100, method: "power", estimated: false });
    expect(activityLoad(activity({ avg_power: 180, weighted_power: 240, np: 250 }), thresholds)?.load).toBeCloseTo(92.16);
    expect(activityLoad(activity({ sport: "run", avg_speed_mps: 3.5, ngs: 1000 / 240 }), thresholds)).toMatchObject({ method: "graded_pace", estimated: false });
    expect(activityLoad(activity({ sport: "run", avg_speed_mps: 3.5, ngs: 1000 / 240 }), thresholds)?.load).toBeCloseTo(100);
    expect(activityLoad(activity({ avg_hr: 140, hr_rms: 160 }), { bike: { lthrBpm: 160 } })?.load).toBeCloseTo(100);
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

  it("FC de repos connue : réserve cardiaque, une marche à FC basse pèse peu ; au seuil, toujours 100", () => {
    const walk = activity({ sport: "other", avg_hr: 90 });
    expect(activityLoad(walk, { run: { lthrBpm: 180 } })?.load).toBeCloseTo(25);
    // (90 − 46) / (180 − 46) = 0,33 : 11 points par heure au lieu de 25.
    expect(activityLoad(walk, { run: { lthrBpm: 180 }, general: { restingHrBpm: 46 } })?.load).toBeCloseTo(10.8, 1);
    expect(activityLoad(activity({ sport: "run", avg_hr: 180 }), { run: { lthrBpm: 180 }, general: { restingHrBpm: 46 } })?.load).toBeCloseTo(100);
    expect(heartIntensity(150, 180)).toBeCloseTo(0.833, 3);
    // Repos trop proche du seuil (saisie douteuse) : le rapport simple.
    expect(heartIntensity(150, 180, 170)).toBeCloseTo(0.833, 3);
  });

  it("FC de repos de référence : médiane des jours renseignés, trois au moins", () => {
    expect(medianRestingHr([64, 46, 45, null, 49])).toBe(47.5);
    expect(medianRestingHr([46, 45, 49])).toBe(46);
    expect(medianRestingHr([46, null, 49])).toBeNull();
  });
});

describe("même séance enregistrée par deux appareils", () => {
  const ride = (id: string, start: string, seconds: number, extra: Partial<LoadActivity> = {}) =>
    activity({ id, local_date: start.slice(0, 10), start_time: start, moving_s: seconds, elapsed_s: seconds, ...extra });

  it("la montre (FC) et le compteur (puissance) : seul le compteur compte", () => {
    const watch = ride("watch", "2026-09-26T07:56:49Z", 14147, { avg_hr: 140, hr_rms: 143 });
    const edge = ride("edge", "2026-09-26T07:57:27Z", 14123, { avg_power: 149, weighted_power: 175, avg_hr: 166 });
    const { kept, duplicates } = dropDuplicateRecordings([watch, edge]);
    expect(kept.map((a) => a.id)).toEqual(["edge"]);
    expect(duplicates.map((d) => [d.dropped.id, d.kept.id])).toEqual([["watch", "edge"]]);
  });

  it("des séances qui se suivent, ou de disciplines différentes, comptent toutes", () => {
    const warm = ride("warm", "2026-10-03T13:32:49Z", 77, { avg_power: 69 });
    const main = ride("main", "2026-10-03T13:34:40Z", 5132, { weighted_power: 156 });
    const run = ride("run", "2026-10-03T13:40:00Z", 1800, { sport: "run", avg_speed_mps: 3 });
    // Un chevauchement bref (moins de la moitié de la plus courte) n'est pas un doublon.
    const late = ride("late", "2026-10-03T14:50:00Z", 1800, { weighted_power: 150 });
    expect(dropDuplicateRecordings([warm, main, run, late]).kept).toHaveLength(4);
    // Sans heure de départ : rien n'est supposé.
    expect(dropDuplicateRecordings([activity({ id: "x" }), activity({ id: "y" })]).kept).toHaveLength(2);
  });

  it("charge du jour comptée une fois ; la séance rattachée au doublon n'est pas recomptée par son retour", () => {
    const session: FitnessSession = { id: "long", scheduled_date: "2026-09-26", state: "published", content: workout(14400, 65) };
    const { actual, coverage, items } = dailyLoads({
      today: "2026-10-01",
      sessions: [session],
      activities: [
        ride("watch", "2026-09-26T07:56:49Z", 14147, { avg_hr: 140 }),
        ride("edge", "2026-09-26T07:57:27Z", 14123, { weighted_power: 175 }),
      ],
      matches: new Map([["watch", "long"]]),
      completions: new Map([["long", { session_id: "long", status: "done", rpe: 6 }]]),
      thresholdsOn: () => ({ bike: { ftpW: 270, lthrBpm: 170 } }),
    });
    expect(items.map((i) => [i.kind, i.id])).toEqual([["activity", "edge"]]);
    expect(actual.get("2026-09-26")).toBeCloseTo(tss(14123, 175 / 270));
    expect(coverage).toMatchObject({ fit: 1, duplicates: 1, feedback: 0 });
  });
});

describe("seuils saisis après les activités", () => {
  it("l'activité compte, et l'estimation est dite", () => {
    const { coverage, items } = dailyLoads({
      today: "2026-10-31",
      sessions: [],
      activities: [
        activity({ id: "old", local_date: "2026-08-16", weighted_power: 210 }),
        activity({ id: "new", local_date: "2026-10-27", weighted_power: 199 }),
        activity({ id: "swim", sport: "swim", local_date: "2026-10-27", avg_speed_mps: 0.8 }),
      ],
      matches: new Map(),
      completions: new Map(),
      thresholdsOn: () => thresholds,
      // FTP saisie le 19 octobre, CSS saisie le 30 : la sortie d'août et la nage du 27 sont des estimations.
      estimatedOn: (date, keys) => (keys.includes("bike.ftp_w") && date < "2026-10-19") || (keys.includes("swim.css_s_per_100m") && date < "2026-10-30"),
    });
    expect(items).toHaveLength(3);
    expect(coverage).toMatchObject({ fit: 3, backdated: 2 });
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
    expect(formZone(25).key).toBe("recovery");
    expect(formZone(5).key).toBe("recovery");
    expect(formZone(-6).key).toBe("grey");
    expect(formZone(-15).key).toBe("improve");
    expect(formZone(-20).key).toBe("improve");
    expect(formZone(-25).key).toBe("optimal");
    expect(formZone(-40).key).toBe("risk");
    expect(formZone(-40).label).toBe("Attention blessure");
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

describe("simulation de la forme", () => {
  const today = "2026-11-02";
  const model: FitnessModel = {
    today,
    start: { fitness: 50, fatigue: 60 },
    todayActual: 0,
    planned: [
      { kind: "planned", id: "p1", date: "2026-11-03", title: "Seuil", sport: "bike", load: 100, method: "plan" },
      { kind: "planned", id: "p2", date: "2026-11-05", title: "Sortie longue", sport: "bike", load: 150, method: "plan" },
      { kind: "planned", id: "d1", date: "2026-11-07", title: "Brouillon", sport: "run", load: 80, method: "plan", draft: true },
    ],
    horizon: "2026-11-10",
  };

  it("plan publié : les brouillons ne comptent pas ; après la dernière séance, repos supposé", () => {
    const points = simulate(model, PUBLISHED_PLAN);
    expect(points.map((p) => p.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(points.map((p) => p.load)).toEqual([0, 100, 0, 150, 0, 0, 0, 0, 0]);
    expect(points[0].fitness).toBeCloseTo(50 - 50 / 42);
    expect(points[0].fatigue).toBeCloseTo(60 - 60 / 7);
    expect(points.every((p) => p.projected)).toBe(true);
    expect(points.filter((p) => p.afterPlan).map((p) => p.date)[0]).toBe("2026-11-06");
  });

  it("brouillons inclus, séance retirée : la courbe change, rien d'autre", () => {
    const withDraft = simulate(model, { includeDrafts: true, excluded: new Set() });
    expect(withDraft[5].load).toBe(80);
    expect(withDraft.filter((p) => p.afterPlan)[0].date).toBe("2026-11-08");
    const withoutLong = simulate(model, { includeDrafts: false, excluded: new Set(["p2"]) });
    expect(withoutLong[3].load).toBe(0);
    expect(withoutLong[8].fitness).toBeLessThan(simulate(model, PUBLISHED_PLAN)[8].fitness);
    expect(withoutLong[8].form).toBeGreaterThan(simulate(model, PUBLISHED_PLAN)[8].form);
  });

  it("ce qui est fait aujourd'hui compte, et n'est pas une prévision", () => {
    const points = simulate({ ...model, todayActual: 90 }, PUBLISHED_PLAN);
    expect(points[0]).toMatchObject({ load: 90, projected: false, afterPlan: false });
  });

  it("forme au départ d'une course : la veille au soir ; condition sur 7 jours", () => {
    const points = simulate(model, PUBLISHED_PLAN);
    expect(formOnRaceMorning(points, "2026-11-06")).toBeCloseTo(points[3].form);
    expect(formOnRaceMorning(points, "2026-11-02")).toBeNull();
    const steady = fitnessSeries(new Map(Array.from({ length: 30 }, (_, i) => [addDays("2026-10-01", i), 100] as const)), new Map(), "2026-10-01", "2026-10-30", "2026-11-01");
    expect(weeklyRamp(steady, "2026-10-30")).toBeGreaterThan(0);
    expect(weeklyRamp(steady, "2026-10-03")).toBeNull();
  });
});

describe("détail des charges", () => {
  it("chaque charge comptée ou prévue est détaillée ; un brouillon à venir est marqué, pas compté", () => {
    const today = "2026-10-19";
    const bike = (id: string, date: string, state = "published"): FitnessSession => ({ id, scheduled_date: date, state, content: workout(3600, 100), title: `Séance ${id}`, sport: "bike" });
    const { items, planned } = dailyLoads({
      today,
      sessions: [bike("done", "2026-10-16"), bike("next", "2026-10-21"), bike("draft", "2026-10-22", "draft"), bike("old-draft", "2026-10-10", "draft")],
      activities: [activity({ id: "a1", name: "Sortie du matin", local_date: "2026-10-15", weighted_power: 200 })],
      matches: new Map(),
      completions: new Map([["done", { session_id: "done", status: "done", rpe: 7 }]]),
      thresholdsOn: at,
    });
    expect(items.map((i) => [i.kind, i.id, i.title, i.method, i.draft ?? false])).toEqual([
      ["activity", "a1", "Sortie du matin", "power", false],
      ["feedback", "done", "Séance done", "rpe", false],
      ["planned", "next", "Séance next", "plan", false],
      ["planned", "draft", "Séance draft", "plan", true],
    ]);
    expect(items[0].load).toBeCloseTo(64);
    expect(planned.has("2026-10-22")).toBe(false);
  });
});
