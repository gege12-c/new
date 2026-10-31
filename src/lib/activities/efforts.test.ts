import { describe, expect, it } from "vitest";
import { parseWorkout, type Workout } from "@/lib/workout/schema";
import { compareEfforts } from "./efforts";
import { lap, type ActivityLap } from "./streams";

function workout(raw: unknown): Workout {
  const parsed = parseWorkout(raw);
  if (!parsed.success) throw new Error("séance de test invalide");
  return parsed.data;
}

const threeByEight = workout({
  schemaVersion: 1,
  segments: [
    {
      id: "s1",
      sport: "bike",
      steps: [
        { kind: "step", id: "wu", type: "warmup", length: { unit: "time", seconds: 900 } },
        {
          kind: "repeat",
          id: "r",
          count: 3,
          steps: [
            { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 480 }, targets: [{ metric: "power", unit: "percent_ftp", min: 95, max: 100 }] },
            { kind: "step", id: "off", type: "recovery", length: { unit: "time", seconds: 180 } },
          ],
        },
      ],
    },
  ],
});

const effort = (start: number, watts: number | null, kind: ActivityLap["kind"] = "work") =>
  lap({ start_s: start, duration_s: 480, distance_m: null, avg_power: watts, avg_hr: 150, max_hr: null, avg_cadence: null, avg_speed_mps: 9, kind })!;

describe("efforts prévus et réalisés", () => {
  it("chaque effort face à sa cible en watts : au-dessus, dans la cible, en dessous", () => {
    const result = compareEfforts(threeByEight, { bike: { ftpW: 250 } }, [effort(900, 262), effort(1560, 245), effort(1200, null, "recovery"), effort(2220, 230)], "bike")!;
    expect(result).toMatchObject({ planned: 3, detected: 3 });
    expect(result.rows.map((r) => r.verdict)).toEqual(["above", "in", "below"]);
    expect(result.rows[0]).toEqual({ rank: 1, planned: { length: "8 min", target: "238–250 W" }, actual: { durationS: 480, value: "262 W" }, verdict: "above", metric: "power" });
  });

  it("nombres différents : comparés dans l'ordre, le manque est dit ; sans seuil, rien n'est jugé", () => {
    const result = compareEfforts(threeByEight, undefined, [effort(900, 250)], "bike")!;
    expect(result).toMatchObject({ planned: 3, detected: 1 });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ planned: { target: "95–100 % FTP" }, actual: { value: null }, verdict: "unknown" });
    expect(result.rows[2].actual).toBeNull();
  });

  it("allure : plus rapide que la cible = au-dessus ; autre discipline ou aucun effort détecté : rien", () => {
    const run = workout({
      schemaVersion: 1,
      segments: [{ id: "s1", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "distance", meters: 1000 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 230, max: 240 }] }] }],
    });
    const fast = lap({ start_s: 600, duration_s: 220, distance_m: 1000, avg_power: null, avg_hr: 170, max_hr: null, avg_cadence: null, avg_speed_mps: 1000 / 220, kind: "work" })!;
    expect(compareEfforts(run, undefined, [fast], "run")!.rows[0]).toMatchObject({ actual: { value: "3:40 /km" }, verdict: "above", metric: "pace" });
    expect(compareEfforts(run, undefined, [fast], "bike")).toBeNull();
    expect(compareEfforts(threeByEight, undefined, [effort(0, 200, null)], "bike")).toBeNull();
  });
});
