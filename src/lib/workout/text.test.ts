import { describe, expect, it } from "vitest";
import { inferStepType, parseDistance, parseDuration, parseWorkoutText } from "./text";

describe("séance écrite en texte", () => {
  it("durées et distances", () => {
    expect(["15m", "1h30m", "15min", "1m30s", "45s", "1h", "abc", "0m"].map(parseDuration)).toEqual([900, 5400, 900, 90, 45, 3600, null, null]);
    expect([parseDistance("2km", "run"), parseDistance("1,5km", "run"), parseDistance("400mtr", "run"), parseDistance("400m", "swim"), parseDistance("400m", "run")]).toEqual([
      2000, 1500, 400, 400, null,
    ]);
  });

  it("vélo : intitulé de section, répétition, % FTP, zones, watts, cadence", () => {
    const { workout, issues, steps } = parseWorkoutText(
      ["Échauffement", "- 15m 55-70%", "", "4x Seuil", "- 8m 95-105% 85-95rpm", "- 3m Z1 récup", "", "- 10m 150w Retour au calme"].join("\n"),
      "bike",
    );
    expect(issues).toEqual([]);
    expect(steps).toBe(4);
    const [warm, repeat, cool] = workout!.segments[0].steps;
    expect(warm).toMatchObject({ kind: "step", type: "warmup", label: "Échauffement", length: { unit: "time", seconds: 900 }, targets: [{ metric: "power", unit: "percent_ftp", min: 55, max: 70 }] });
    expect(repeat).toMatchObject({ kind: "repeat", count: 4, label: "Seuil" });
    if (repeat.kind !== "repeat") throw new Error("répétition attendue");
    expect(repeat.steps[0]).toMatchObject({ type: "active", targets: [{ metric: "power", unit: "percent_ftp", min: 95, max: 105 }, { metric: "cadence", unit: "rpm", min: 85, max: 95 }] });
    expect(repeat.steps[1]).toMatchObject({ type: "recovery", label: "récup", targets: [{ metric: "power", unit: "zone", min: 1, max: 1 }] });
    expect(cool).toMatchObject({ type: "cooldown", label: "Retour au calme", targets: [{ metric: "power", unit: "watts", min: 150, max: 150 }] });
  });

  it("course et natation : allures, % LTHR, FC, RPE, distances", () => {
    const run = parseWorkoutText(["- 2km Z2 HR", "6x", "- 400mtr 3:50-4:00/km Pace", "- 90s RPE 2", "", "- 10m 80% LTHR"].join("\n"), "run");
    expect(run.issues).toEqual([]);
    const [easy, set, end] = run.workout!.segments[0].steps;
    expect(easy).toMatchObject({ length: { unit: "distance", meters: 2000 }, targets: [{ metric: "heart_rate", unit: "zone", min: 2, max: 2 }] });
    if (set.kind !== "repeat") throw new Error("répétition attendue");
    expect(set.steps[0]).toMatchObject({ length: { unit: "distance", meters: 400 }, targets: [{ metric: "pace", unit: "sec_per_km", min: 230, max: 240 }] });
    expect(set.steps[1]).toMatchObject({ length: { unit: "time", seconds: 90 }, targets: [{ metric: "rpe", unit: "scale", min: 2, max: 2 }] });
    expect(end).toMatchObject({ targets: [{ metric: "heart_rate", unit: "percent_lthr", min: 80, max: 80 }] });

    const swim = parseWorkoutText(["- 400m Échauffement", "8x", "- 100m 1:40/100m"].join("\n"), "swim");
    expect(swim.issues).toEqual([]);
    expect(swim.workout!.segments[0].steps[0]).toMatchObject({ type: "warmup", length: { unit: "distance", meters: 400 } });
  });

  it("problèmes expliqués ligne par ligne, rien d’inventé", () => {
    const result = parseWorkoutText(["- Z2 sans durée", "3x", "", "- 10m"].join("\n"), "run");
    expect(result.issues).toEqual([
      { line: 1, message: "Durée ou distance manquante (par exemple 15m, 1h30m, 30s, 2km, 400mtr)." },
      { line: 3, message: "Répétition « 3x » sans étape : ajoutez des lignes « - … » juste en dessous." },
    ]);
    expect(result.workout?.segments[0].steps).toHaveLength(1);
    expect(parseWorkoutText("", "bike")).toMatchObject({ workout: null, issues: [{ line: null, message: expect.stringContaining("au moins une étape") }] });
    // Une cible impossible pour la discipline est refusée par le format, avec son message.
    const swimWatts = parseWorkoutText("- 10m 200w", "swim");
    expect(swimWatts.workout).toBeNull();
    expect(swimWatts.issues.length).toBeGreaterThan(0);
  });

  it("type d’étape déduit de l’intitulé", () => {
    expect(["Échauffement", "Warm up", "Retour au calme", "récup active", "Repos", "Éducatifs", "Transition", "Seuil", undefined].map(inferStepType)).toEqual([
      "warmup",
      "warmup",
      "cooldown",
      "recovery",
      "rest",
      "drill",
      "transition",
      "active",
      "active",
    ]);
  });
});
