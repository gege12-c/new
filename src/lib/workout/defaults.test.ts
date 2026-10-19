import { describe, expect, it } from "vitest";
import { profileBars, profileScale } from "@/components/workout/workout-profile";
import { rpePercent } from "./compute";
import { defaultTarget, defaultWorkout, isDefaultWorkout, retargetForType, targetForStep, updateStep } from "./edit";
import { SESSION_SPORTS, WorkoutSchema, type Step, type Workout } from "./schema";
import type { AthleteThresholds } from "./zones";

const none: AthleteThresholds = { bike: {}, run: {}, swim: {}, general: {} };
const full: AthleteThresholds = { bike: { ftpW: 250 }, run: { thresholdPaceSPerKm: 270 }, swim: { cssSPer100m: 100 }, general: {} };

describe("valeurs de départ des cibles", () => {
  it("dépendent du type d'étape : une récupération n'a pas l'intensité d'un bloc de travail", () => {
    for (const key of ["power.watts", "power.percent_ftp", "heart_rate.bpm", "rpe.scale", "power.zone"]) {
      const work = targetForStep(key, "bike", "active", full);
      const recovery = targetForStep(key, "bike", "recovery", full);
      expect(recovery.max, key).toBeLessThan(work.min);
    }
    expect(targetForStep("power.watts", "bike", "active", full)).toMatchObject({ min: 220, max: 238 });
    // Sans FTP : valeurs plausibles, à ajuster.
    expect(targetForStep("power.watts", "bike", "recovery", none)).toMatchObject({ min: 104, max: 127 });
  });

  it("convertissent une vitesse en allure : plus vite veut dire moins de secondes au kilomètre", () => {
    const work = targetForStep("pace.sec_per_km", "run", "active", full);
    const easy = targetForStep("pace.sec_per_km", "run", "warmup", full);
    expect(work.min).toBeLessThan(work.max);
    expect(work.max).toBeLessThan(easy.min);
    expect(work).toMatchObject({ min: 265, max: 278 });
  });

  it("modèle : relatives aux seuils ; athlète : relatives à son seuil, sinon effort ressenti", () => {
    expect(defaultTarget("run", "active")).toMatchObject({ metric: "pace", unit: "percent_threshold" });
    expect(defaultTarget("run", "active", full)).toMatchObject({ metric: "pace", unit: "percent_threshold" });
    expect(defaultTarget("run", "active", none)).toMatchObject({ metric: "rpe", min: 7, max: 8 });
    expect(defaultTarget("swim", "warmup", none)).toMatchObject({ metric: "rpe" });
    // Le vélo garde le % FTP : compteurs et Zwift appliquent leur propre FTP.
    expect(defaultTarget("bike", "active", none)).toMatchObject({ metric: "power", unit: "percent_ftp" });
    expect(defaultTarget("bike", "rest", none)).toBeNull();
  });

  it("donnent une séance de départ valide pour chaque discipline, avec ou sans seuils", () => {
    for (const sport of SESSION_SPORTS) {
      for (const thresholds of [undefined, none, full]) expect(WorkoutSchema.safeParse(defaultWorkout(sport, thresholds)).success, sport).toBe(true);
    }
  });
});

describe("changement de discipline et de type d'étape", () => {
  it("reconnaît la séance de départ encore intacte, quels que soient ses identifiants", () => {
    const fresh = defaultWorkout("run", none);
    expect(isDefaultWorkout(fresh, "run", none)).toBe(true);
    expect(isDefaultWorkout(defaultWorkout("run", none), "run", none)).toBe(true);
    expect(isDefaultWorkout(fresh, "run", full)).toBe(false);
    const edited = updateStep(fresh, [0, 0], { length: { unit: "time", seconds: 1200 } });
    expect(isDefaultWorkout(edited, "run", none)).toBe(false);
  });

  it("une cible de départ suit le nouveau type d'étape, une cible réglée reste telle quelle", () => {
    const step: Step = { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 600 }, targets: [targetForStep("power.watts", "bike", "active", full)] };
    expect(retargetForType(step, "recovery", "bike", full)).toEqual([targetForStep("power.watts", "bike", "recovery", full)]);
    const tuned: Step = { ...step, targets: [{ metric: "power", unit: "watts", min: 200, max: 210 }] };
    expect(retargetForType(tuned, "recovery", "bike", full)).toEqual(tuned.targets);
  });
});

describe("profil d'une séance sans seuil", () => {
  const watts: Workout = {
    schemaVersion: 1,
    segments: [
      {
        id: "s",
        sport: "bike",
        steps: [
          { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 900 }, targets: [] },
          {
            kind: "repeat",
            id: "r",
            count: 3,
            steps: [
              { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 600 }, targets: [{ metric: "power", unit: "watts", min: 200, max: 220 }] },
              { kind: "step", id: "off", type: "recovery", length: { unit: "time", seconds: 180 }, targets: [{ metric: "power", unit: "watts", min: 130, max: 160 }] },
            ],
          },
          { kind: "step", id: "cd", type: "cooldown", length: { unit: "time", seconds: 600 }, targets: [] },
        ],
      },
    ],
  };

  it("compare les étapes entre elles quand la FTP manque, sans inventer de zone", () => {
    const bars = profileBars(watts, none);
    const [warmup, work, recovery] = bars;
    expect(work).toMatchObject({ percent: null, relative: true });
    expect(work.ratio).toBeGreaterThan(recovery.ratio);
    expect(recovery.ratio).toBeGreaterThan(warmup.ratio);
    expect(warmup.relative).toBe(false);
    expect(profileScale(watts, none)).toBe("relative");
  });

  it("ne trace pas le seuil quand des étapes en W sans FTP côtoient des étapes en % FTP", () => {
    const mixed = structuredClone(watts);
    const warmup = mixed.segments[0].steps[0];
    if (warmup.kind === "step") warmup.targets = [{ metric: "power", unit: "percent_ftp", min: 55, max: 70 }];
    expect(profileScale(mixed, none)).toBe("mixed");
    expect(profileScale(mixed, full)).toBe("threshold");
  });

  it("revient aux zones dès que la FTP est connue", () => {
    const bars = profileBars(watts, full);
    expect(bars[1].percent).toBeCloseTo(84, 0);
    expect(bars[1].relative).toBe(false);
    expect(profileScale(watts, full)).toBe("threshold");
  });
});

describe("effort ressenti", () => {
  it("se place dans les zones : 3–4 endurance, 7–8 seuil, 9 VO2max", () => {
    expect(rpePercent(3.5)).toBeGreaterThanOrEqual(56);
    expect(rpePercent(3.5)).toBeLessThan(76);
    expect(rpePercent(7.5)).toBeGreaterThanOrEqual(91);
    expect(rpePercent(7.5)).toBeLessThan(106);
    expect(rpePercent(9)).toBeGreaterThanOrEqual(106);
    expect(rpePercent(1)).toBeLessThan(56);
    expect(rpePercent(12)).toBe(125);
  });
});
