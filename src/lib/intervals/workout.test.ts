import { describe, expect, it } from "vitest";
import { bikeThreshold, brick, swimCss } from "@/lib/workout/fixtures";
import { WorkoutSchema, type WorkoutInput } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { buildIntervalsEvents, intervalsDistance, intervalsDuration, type IntervalsContext } from "./workout";

const thresholds: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 165 },
  run: { thresholdPaceSPerKm: 240, lthrBpm: 172 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};
const SESSION = "0b6f9d3c-2f4e-4c1a-9a57-3d2c1b0a9e8f";
const ctx = (overrides: Partial<IntervalsContext> = {}): IntervalsContext => ({
  sessionId: SESSION,
  title: "Seuil 4 × 8 min",
  description: null,
  nutrition: null,
  date: "2026-11-02",
  thresholds,
  ...overrides,
});
const build = (input: WorkoutInput, overrides: Partial<IntervalsContext> = {}) => buildIntervalsEvents(WorkoutSchema.parse(input), ctx(overrides));
/** Lignes d'étapes et de répétitions du texte (après la description et les consignes), sans lignes vides. */
const stepsOf = (description: string) => {
  const lines = description.split("\n");
  const first = lines.findIndex((l) => l.startsWith("- ") || /^\d+x$/.test(l));
  return lines.slice(first).filter(Boolean);
};

describe("séance TriCoach → séance prévue d'intervals.icu", () => {
  it("durées et distances au format d'intervals.icu", () => {
    expect([900, 90, 3600, 3725, 45].map(intervalsDuration)).toEqual(["15m", "1m30s", "1h", "1h2m5s", "45s"]);
    expect([intervalsDistance(400, "run"), intervalsDistance(1500, "run"), intervalsDistance(10_000, "bike"), intervalsDistance(1500, "swim")]).toEqual([
      "400mtr",
      "1.5km",
      "10km",
      "1500mtr",
    ]);
  });

  it("vélo au seuil : watts absolus calculés avec la FTP de TriCoach, cadence, répétition entre lignes vides", () => {
    const [bike] = build(bikeThreshold, { description: "Rester assis.", nutrition: "1 bidon par heure" });
    expect(bike.issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(bike.event).toMatchObject({
      category: "WORKOUT",
      start_date_local: "2026-11-02T00:00:00",
      type: "Ride",
      name: "Seuil 4 × 8 min",
      external_id: `tricoach-${SESSION}-0`,
    });
    expect(bike.event!.description).toBe(
      [
        "Rester assis.",
        "Nutrition : 1 bidon par heure",
        "",
        "- Échauffement 15m 138-175w",
        "",
        "4x",
        "- Travail 8m 238-250w 85-95rpm",
        "- Récupération 3m 0-138w",
        "",
        "- Retour au calme 10m 125-150w",
        "",
      ].join("\n"),
    );
  });

  it("natation : allure absolue par 100 m, distances en mètres, départ et matériel repris en consignes", () => {
    const [swim] = build(swimCss, { title: "CSS 8 × 100" });
    expect(swim.event!.type).toBe("Swim");
    const text = swim.event!.description;
    expect(text).toContain("- Échauffement 400mtr");
    expect(text).toContain("8x\n- Travail 100mtr 1:38/100m-1:42/100m Pace");
    expect(text).toContain("- Retour au calme 200mtr");
    expect(text).toContain("Consignes :\nÉtape 2, Travail : départ toutes les 1:50\nÉtape 3, Retour au calme : matériel : pull-buoy");
    expect(swim.issues).toContainEqual({
      severity: "loss",
      where: "Étape 2, Travail",
      message: "Départ toutes les 1:50 : absent du format d'intervals.icu, repris dans la description.",
    });
  });

  it("enchaînement : une séance par discipline, le même jour, identifiants distincts", () => {
    const parts = build(brick, { title: "Enchaînement" });
    expect(parts.map((p) => [p.event?.type, p.event?.name, p.externalId])).toEqual([
      ["Ride", "Enchaînement (1/2 vélo)", `tricoach-${SESSION}-0`],
      ["Run", "Enchaînement (2/2 course à pied)", `tricoach-${SESSION}-1`],
    ]);
    expect(stepsOf(parts[1].event!.description)).toEqual(["- Transition 2m", "- Travail 20m 4:30/km-4:40/km Pace"]);
  });

  it("sans seuil dans TriCoach : la cible reste relative, intervals.icu la calcule avec ses propres réglages (dit)", () => {
    const [bike] = build(bikeThreshold, { thresholds: {} });
    expect(stepsOf(bike.event!.description)[0]).toBe("- Échauffement 15m 55-70%");
    expect(bike.event!.description).toContain("- Récupération 3m Z1");
    expect(bike.issues).toContainEqual({
      severity: "info",
      message: "Cibles en % de la FTP : sans valeur dans TriCoach, intervals.icu les calcule avec la FTP réglée chez lui.",
    });
  });

  it("fréquence cardiaque : en % du seuil (bpm convertis avec la FC seuil de TriCoach), % de FC max, zones", () => {
    const run = (targets: WorkoutInput["segments"][number]["steps"][number] extends infer S ? (S extends { targets?: infer T } ? T : never) : never) =>
      build({ schemaVersion: 1, segments: [{ id: "r", sport: "run", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 1200 }, targets }] }] })[0];
    expect(stepsOf(run([{ metric: "heart_rate", unit: "bpm", min: 155, max: 165 }]).event!.description)).toEqual(["- Travail 20m 90-96% LTHR"]);
    expect(stepsOf(run([{ metric: "heart_rate", unit: "percent_max_hr", min: 75, max: 80 }]).event!.description)).toEqual(["- Travail 20m 75-80% HR"]);
    expect(stepsOf(run([{ metric: "heart_rate", unit: "zone", min: 2, max: 3 }]).event!.description)).toEqual(["- Travail 20m Z2-Z3 HR"]);
    expect(run([{ metric: "heart_rate", unit: "bpm", min: 155, max: 165 }]).issues[0].message).toContain("(172 bpm)");
  });

  it("ce que le format ne porte pas : durée libre et répétitions bloquent (expliqué), RPE et cadence de course en consignes", () => {
    const input: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "run",
          sport: "run",
          steps: [
            {
              kind: "step",
              id: "w",
              type: "warmup",
              length: { unit: "time", seconds: 600 },
              targets: [
                { metric: "rpe", unit: "scale", min: 3, max: 4 },
                { metric: "cadence", unit: "spm", min: 170, max: 180 },
              ],
            },
          ],
        },
        { id: "free", sport: "run", steps: [{ kind: "step", id: "o", type: "drill", length: { unit: "open" } }] },
        { id: "gym", sport: "strength", steps: [{ kind: "step", id: "s", type: "active", label: "Squats", length: { unit: "reps", reps: 12 } }] },
      ],
    };
    const [run, free, gym] = build(input);
    expect(stepsOf(run.event!.description)).toEqual(["- Échauffement 10m"]);
    expect(run.event!.description).toContain("Étape 1, Échauffement : effort ressenti RPE 3–4, 170–180 pas/min");
    expect(free.event).toBeNull();
    expect(free.issues.at(-1)).toMatchObject({ severity: "blocking", message: expect.stringContaining("durée libre (bouton tour)") });
    expect(gym.event).toBeNull();
    expect(gym.issues.at(-1)).toMatchObject({ severity: "blocking", message: expect.stringContaining("répétitions") });
  });

  it("textes sûrs : un intitulé à chiffres n'est pas lu comme une durée, une consigne ne devient pas une répétition", () => {
    const input: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "b",
          sport: "bike",
          steps: [{ kind: "step", id: "x", type: "active", label: "Sprints 10s", notes: "Enchaîner 3x", length: { unit: "time", seconds: 300 } }],
        },
      ],
    };
    const [part] = build(input, { description: "- Échauffement libre\nPuis 4x" });
    const text = part.event!.description;
    expect(stepsOf(text)).toEqual(["- Travail 5m"]);
    expect(text.startsWith("Échauffement libre\nPuis 4 fois")).toBe(true);
    expect(text).toContain("Étape 1, Sprints 10s : Sprints 10s, Enchaîner 3 fois");
  });

  it("répétitions imbriquées déroulées dans l'unique niveau de répétition", () => {
    const input: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "seg",
          sport: "run",
          steps: [
            {
              kind: "repeat",
              id: "outer",
              count: 2,
              steps: [
                { kind: "repeat", id: "inner", count: 2, steps: [{ kind: "step", id: "f", type: "active", length: { unit: "distance", meters: 200 } }] },
                { kind: "step", id: "r", type: "rest", length: { unit: "time", seconds: 120 } },
              ],
            },
          ],
        },
      ],
    };
    const [part] = build(input);
    expect(stepsOf(part.event!.description)).toEqual(["2x", "- Travail 200mtr", "- Travail 200mtr", "- Repos 2m"]);
  });
});
