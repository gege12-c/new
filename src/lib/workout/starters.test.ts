import { describe, expect, it } from "vitest";
import { computeTotals } from "./compute";
import { updateStep } from "./edit";
import { SESSION_SPORTS, WorkoutSchema, sessionSportOf, type Target, type WorkoutNode } from "./schema";
import { buildStarter, effortTarget, matchingStarter, startersFor, STARTER_TITLES, type Effort } from "./starters";
import { PACE_ZONES, POWER_ZONES, type AthleteThresholds } from "./zones";

const full: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 165 },
  run: { thresholdPaceSPerKm: 300, lthrBpm: 172 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};
const none: AthleteThresholds = {};

function targetsOf(nodes: WorkoutNode[]): Target[] {
  return nodes.flatMap((node) => (node.kind === "repeat" ? targetsOf(node.steps) : node.targets));
}

describe("séances types", () => {
  it("chaque discipline du triathlon en propose plusieurs, toutes valides, sans titre en double", () => {
    const ids = new Set<string>();
    for (const sport of SESSION_SPORTS) {
      const starters = startersFor(sport);
      // « Autre » (yoga, ski…) : trop varié pour une séance type.
      expect(starters.length).toBeGreaterThanOrEqual(sport === "other" ? 0 : 2);
      for (const starter of starters) {
        expect(ids.has(starter.id)).toBe(false);
        ids.add(starter.id);
        for (const thresholds of [undefined, full, none]) {
          const workout = WorkoutSchema.parse(buildStarter(starter, thresholds));
          expect(sessionSportOf(workout)).toBe(sport);
        }
      }
    }
    expect(STARTER_TITLES.size).toBe(ids.size);
  });

  it("cibles de la même famille que l'éditeur : % FTP, % de l'allure seuil ou de la CSS, sinon RPE", () => {
    const run = startersFor("run").find((s) => s.id === "run-threshold")!;
    const units = (thresholds?: AthleteThresholds) => new Set(targetsOf(buildStarter(run, thresholds).segments[0].steps).map((t) => `${t.metric}.${t.unit}`));
    expect([...units(full)]).toEqual(["pace.percent_threshold"]);
    expect([...units(undefined)]).toEqual(["pace.percent_threshold"]);
    // Sans allure seuil : l'effort ressenti, qui se passe de tout seuil (rien d'inventé).
    expect([...units(none)]).toEqual(["rpe.scale"]);

    const bike = startersFor("bike").find((s) => s.id === "bike-threshold")!;
    expect(new Set(targetsOf(buildStarter(bike, none).segments[0].steps).map((t) => t.unit))).toEqual(new Set(["percent_ftp"]));

    const css = startersFor("swim").find((s) => s.id === "swim-css")!;
    const swimTargets = targetsOf(buildStarter(css, full).segments[0].steps);
    expect(swimTargets.every((t) => t.unit === "percent_threshold")).toBe(true);
    expect(targetsOf(buildStarter(css, none).segments[0].steps).every((t) => t.unit === "scale")).toBe(true);
  });

  it("intensités prises dans les zones théoriques", () => {
    const inZone = (zones: typeof POWER_ZONES, zone: number, target: Target) => {
      const z = zones.find((x) => x.zone === zone)!;
      return target.min >= z.min && target.max <= z.max;
    };
    const cases: [Effort, number][] = [
      ["recovery", 1],
      ["endurance", 2],
      ["tempo", 3],
      ["threshold", 4],
      ["vo2", 5],
    ];
    for (const [effort, zone] of cases) {
      expect(inZone(POWER_ZONES, zone, effortTarget("bike", effort, full)), `vélo ${effort}`).toBe(true);
      expect(inZone(PACE_ZONES.run, zone, effortTarget("run", effort, full)), `course ${effort}`).toBe(true);
      expect(inZone(PACE_ZONES.swim, zone, effortTarget("swim", effort, full)), `natation ${effort}`).toBe(true);
    }
    // Le sweet spot, par définition, à cheval entre tempo et seuil : 88–94 % de la FTP.
    expect(effortTarget("bike", "sweetspot", full)).toEqual({ metric: "power", unit: "percent_ftp", min: 88, max: 94 });
  });

  it("durées et distances annoncées par les titres", () => {
    const total = (id: string) => {
      const starter = startersFor(id.split("-")[0] as never).find((s) => s.id === id)!;
      return computeTotals(buildStarter(starter, full), full);
    };
    // 15 min + 3 × (8 + 2) + 10 min.
    expect(total("run-threshold").duration).toMatchObject({ value: 55 * 60, status: "exact" });
    // 15 min + 4 × (8 + 3) + 10 min.
    expect(total("bike-threshold").duration.value).toBe(69 * 60);
    expect(total("run-easy").duration.value).toBe(45 * 60);
    // 400 m + 8 × 100 m + 200 m.
    expect(total("swim-css").distance).toMatchObject({ value: 1400, status: "exact" });
    // Enchaînement : 1 h de vélo, 2 min de transition, 20 min de course.
    expect(total("brick-standard").duration.value).toBe(82 * 60);
  });

  it("reconnaît une séance type encore intacte, plus après un réglage", () => {
    const starter = startersFor("run").find((s) => s.id === "run-vma")!;
    const workout = buildStarter(starter, full);
    expect(matchingStarter(workout, "run", full)?.id).toBe("run-vma");
    // Mêmes seuils exigés : une cible recalculée pour d'autres seuils n'est plus « intacte ».
    expect(matchingStarter(workout, "run", none)).toBeNull();
    const changed = updateStep(workout, [0, 0], { length: { unit: "time", seconds: 25 * 60 } });
    expect(matchingStarter(changed, "run", full)).toBeNull();
  });
});
