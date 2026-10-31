import { describe, expect, it } from "vitest";
import { parseWorkout, type Workout } from "@/lib/workout/schema";
import { compareEfforts } from "./efforts";
import { lap, type ActivityLap, type StreamSeries } from "./streams";

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

/** Courbes d'une course : une mesure toutes les 2 s, vitesse (m/s) donnée seconde par seconde. */
function runSeries(speedAt: (t: number) => number, seconds: number, hrAt: (t: number) => number = () => 150): StreamSeries {
  const time: number[] = [];
  const distance: number[] = [];
  const heartrate: number[] = [];
  let covered = 0;
  for (let t = 0; t <= seconds; t += 1) {
    if (t % 2 === 0) {
      time.push(t);
      distance.push(Math.round(covered));
      heartrate.push(hrAt(t));
    }
    covered += speedAt(t);
  }
  return { time, distance, heartrate };
}

/** 10 min d'échauffement, 4 × (30 s vite, 30 s lent), 5 min de retour au calme. */
const strides = workout({
  schemaVersion: 1,
  segments: [
    {
      id: "s",
      sport: "run",
      steps: [
        { kind: "step", id: "w", type: "warmup", length: { unit: "time", seconds: 600 }, targets: [{ metric: "heart_rate", unit: "zone", min: 1, max: 2 }] },
        {
          kind: "repeat",
          id: "r",
          count: 4,
          steps: [
            { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 30 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 225, max: 235 }] },
            { kind: "step", id: "b", type: "recovery", length: { unit: "time", seconds: 30 } },
          ],
        },
        { kind: "step", id: "c", type: "cooldown", length: { unit: "time", seconds: 300 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 330, max: 390 }] },
      ],
    },
  ],
});
const runThresholds = { run: { thresholdPaceSPerKm: 250, lthrBpm: 175 } };

describe("prévu et réalisé, étape par étape sur les courbes", () => {
  it("les efforts sont retrouvés où l'allure change, même décalés et sans tours fiables", () => {
    // Échauffement prolongé de 8 s : tout est décalé ; fractions à 4,35 m/s (3:50/km), dernière plus lente.
    const shift = 608;
    const speedAt = (t: number) => {
      if (t < shift) return 2.9;
      const k = Math.floor((t - shift) / 60);
      const fast = (t - shift) % 60 < 30;
      if (k < 4) return fast ? (k === 3 ? 4.0 : 4.35) : 2.4;
      return 3.0;
    };
    // Tours trompeurs : des kilomètres qui chevauchent les fractions, tous marqués « effort ».
    const laps = [0, 340, 680].map((start) => lap({ start_s: start, duration_s: 345, distance_m: 1000, avg_power: null, avg_hr: null, max_hr: null, avg_cadence: null, avg_speed_mps: 2.9, kind: "work" })!);
    const result = compareEfforts(strides, runThresholds, { laps, series: runSeries(speedAt, 1140), sample_s: 2 }, "run")!;
    expect(result.method).toBe("streams");
    expect(result).toMatchObject({ planned: 4, detected: 4 });
    expect(result.rows.map((r) => r.name)).toEqual(["Échauffement", "Effort 1", "Effort 2", "Effort 3", "Effort 4", "Retour au calme"]);
    const efforts = result.rows.filter((r) => r.effort);
    for (const r of efforts) expect(Math.abs(r.actual!.durationS - 30)).toBeLessThanOrEqual(4);
    // 4,35 m/s = 3:50/km, à la seconde près (distances au mètre).
    for (const r of efforts.slice(0, 3)) expect(r.actual!.value).toMatch(/^3:(49|50|51) \/km$/);
    expect(efforts.map((r) => r.verdict)).toEqual(["in", "in", "in", "below"]);
    // L'échauffement en FC (Z1–Z2) : jugé sur la FC moyenne.
    expect(result.rows[0]).toMatchObject({ metric: "heart_rate", actual: { value: "150 bpm" }, verdict: "in" });
  });

  it("une activité arrêtée avant la fin : la dernière étape est écourtée ou non faite, rien n'est inventé", () => {
    const speedAt = (t: number) => (t < 600 ? 2.9 : (t - 600) % 60 < 30 && t < 840 ? 4.35 : 2.6);
    const stopped = compareEfforts(strides, runThresholds, { laps: [], series: runSeries(speedAt, 845), sample_s: 2 }, "run")!;
    expect(stopped.rows.at(-1)).toMatchObject({ name: "Retour au calme", actual: null, verdict: "unknown" });
    const longer = compareEfforts(strides, runThresholds, { laps: [], series: runSeries(speedAt, 1000), sample_s: 2 }, "run")!;
    expect(longer.rows.at(-1)!.actual).toMatchObject({ partial: true });
    expect(longer.rows.at(-1)!.actual!.durationS).toBeGreaterThan(150);
  });

  it("une activité qui ne suit pas la séance (allure constante) : pas d'étapes inventées, les tours servent", () => {
    const steady = compareEfforts(strides, runThresholds, { laps: [], series: runSeries(() => 3, 1140), sample_s: 2 }, "run");
    expect(steady).toBeNull();
  });

  it("vélo : la puissance sert à retrouver les efforts", () => {
    const time = Array.from({ length: 1381 }, (_, i) => i * 2);
    const watts = time.map((t) => (t >= 900 && (t - 900) % 660 < 480 && t < 900 + 3 * 660 ? 245 : 150));
    const result = compareEfforts(threeByEight, { bike: { ftpW: 250 } }, { laps: [], series: { time, watts }, sample_s: 2 }, "bike")!;
    expect(result.method).toBe("streams");
    expect(result.rows.map((r) => [r.name, r.actual?.value, r.verdict])).toEqual([
      ["Effort 1", "245 W", "in"],
      ["Effort 2", "245 W", "in"],
      ["Effort 3", "245 W", "in"],
    ]);
  });
});

describe("efforts pris dans les tours (sans courbes)", () => {
  it("chaque effort face à sa cible en watts : au-dessus, dans la cible, en dessous", () => {
    const recovery = (start: number) => lap({ start_s: start, duration_s: 180, distance_m: null, avg_power: 140, avg_hr: 130, max_hr: null, avg_cadence: null, avg_speed_mps: 7, kind: "recovery" })!;
    const result = compareEfforts(threeByEight, { bike: { ftpW: 250 } }, { laps: [effort(900, 262), recovery(1380), effort(1560, 245), recovery(2040), effort(2220, 230)] }, "bike")!;
    expect(result).toMatchObject({ planned: 3, detected: 3, method: "laps" });
    expect(result.rows.map((r) => r.verdict)).toEqual(["above", "in", "below"]);
    expect(result.rows[0]).toEqual({
      rank: 1,
      name: "Effort 1",
      effort: true,
      planned: { length: "8 min", target: "238–250 W" },
      actual: { durationS: 480, value: "262 W", partial: false },
      verdict: "above",
      metric: "power",
    });
  });

  it("nombres différents : comparés dans l'ordre, le manque est dit ; sans seuil, rien n'est jugé", () => {
    const result = compareEfforts(threeByEight, undefined, { laps: [effort(900, 250), lap({ start_s: 1380, duration_s: 180, distance_m: null, avg_power: null, avg_hr: null, max_hr: null, avg_cadence: null, avg_speed_mps: null, kind: "recovery" })!] }, "bike")!;
    expect(result).toMatchObject({ planned: 3, detected: 1 });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ planned: { target: "95–100 % FTP" }, actual: { value: null }, verdict: "unknown" });
    expect(result.rows[2].actual).toBeNull();
  });

  it("tours tous marqués « effort » : ceux de la durée prévue, plus intenses que leurs voisins", () => {
    const run = workout({
      schemaVersion: 1,
      segments: [
        {
          id: "s",
          sport: "run",
          steps: [
            { kind: "step", id: "w", type: "warmup", length: { unit: "time", seconds: 600 } },
            {
              kind: "repeat",
              id: "r",
              count: 2,
              steps: [
                { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 20 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 283, max: 305 }] },
                { kind: "step", id: "b", type: "recovery", length: { unit: "time", seconds: 20 } },
              ],
            },
          ],
        },
      ],
    });
    const at = (start: number, duration: number, meters: number) =>
      lap({ start_s: start, duration_s: duration, distance_m: meters, avg_power: null, avg_hr: null, max_hr: null, avg_cadence: null, avg_speed_mps: meters / duration, kind: "work" })!;
    const result = compareEfforts(run, undefined, { laps: [at(0, 600, 1750), at(600, 20, 50), at(620, 20, 75), at(640, 20, 52), at(660, 20, 70), at(680, 20, 50)] }, "run")!;
    expect(result.rows.map((r) => r.actual?.value)).toEqual(["4:27 /km", "4:46 /km"]);
  });

  it("allure : plus rapide que la cible = au-dessus ; autre discipline ou aucun effort détecté : rien", () => {
    const run = workout({
      schemaVersion: 1,
      segments: [{ id: "s1", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "distance", meters: 1000 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 230, max: 240 }] }] }],
    });
    const fast = lap({ start_s: 600, duration_s: 220, distance_m: 1000, avg_power: null, avg_hr: 170, max_hr: null, avg_cadence: null, avg_speed_mps: 1000 / 220, kind: "work" })!;
    const slow = lap({ start_s: 820, duration_s: 300, distance_m: 900, avg_power: null, avg_hr: 140, max_hr: null, avg_cadence: null, avg_speed_mps: 3, kind: "recovery" })!;
    expect(compareEfforts(run, undefined, { laps: [fast, slow] }, "run")!.rows[0]).toMatchObject({ actual: { value: "3:40 /km" }, verdict: "above", metric: "pace" });
    expect(compareEfforts(run, undefined, { laps: [fast, slow] }, "bike")).toBeNull();
    // Tours sans effort marqué : retenus s'ils ont la durée prévue, sinon rien.
    expect(compareEfforts(threeByEight, undefined, { laps: [effort(0, 200, null)] }, "bike")).toMatchObject({ detected: 1 });
    const minute = lap({ start_s: 0, duration_s: 60, distance_m: null, avg_power: 200, avg_hr: null, max_hr: null, avg_cadence: null, avg_speed_mps: null, kind: null })!;
    expect(compareEfforts(threeByEight, undefined, { laps: [minute] }, "bike")).toBeNull();
  });
});
