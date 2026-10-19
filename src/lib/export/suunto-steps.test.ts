import { describe, expect, it } from "vitest";
import { bikeThreshold, brick, swimCss } from "@/lib/workout/fixtures";
import { WorkoutSchema, type WorkoutInput } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { suuntoPlan, type SuuntoRepeat, type SuuntoStep } from "./suunto-steps";

const thresholds: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 165 },
  run: { thresholdPaceSPerKm: 240, lthrBpm: 172 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};

const plan = (input: WorkoutInput, t: AthleteThresholds | undefined = thresholds, description: string | null = null) =>
  suuntoPlan(WorkoutSchema.parse(input), { title: "Séance", description, thresholds: t });

describe("fiche « étapes Suunto »", () => {
  it("écrit chaque étape comme le créateur de Suunto : type, fin, objectif en valeur absolue", () => {
    const [bike] = plan(bikeThreshold, thresholds, "Rester assis.\n\nBoire toutes les 15 min.").segments;
    expect(bike.sportMode).toMatch(/^Cyclisme/);
    expect(bike.stepCount).toBe(4);
    const [warmup, main, cooldown] = bike.items;
    expect(warmup).toEqual({ kind: "step", phase: "Échauffement", name: null, end: { kind: "duration", text: "15 min" }, target: { kind: "power", value: "138–175 W" }, notes: [] });
    expect(main.kind).toBe("repeat");
    const repeat = main as SuuntoRepeat;
    expect(repeat.count).toBe(4);
    expect(repeat.steps.map((s) => [s.phase, s.end.text, s.target?.value])).toEqual([
      ["Intervalle", "8 min", "238–250 W"],
      ["Récupération", "3 min", "0–138 W"],
    ]);
    // Suunto ne suit pas la cadence : elle est écrite à côté de l'étape.
    expect(repeat.steps[0].notes).toEqual(["Cadence 85–95 rpm"]);
    expect((cooldown as SuuntoStep).phase).toBe("Retour au calme");
    expect(bike.warnings).toEqual([]);
  });

  it("garde la description pour la montre, en une ligne", () => {
    expect(plan(bikeThreshold, thresholds, "Rester assis.\n\nBoire toutes les 15 min.").description).toBe("Rester assis. Boire toutes les 15 min.");
    expect(plan(bikeThreshold, thresholds, "x".repeat(400)).description).toMatch(/^x{297}\.\.\.$/);
    expect(plan(bikeThreshold).description).toBeNull();
  });

  it("sans seuil, ne devine rien : l'objectif reste à côté et le seuil manquant est dit une fois", () => {
    const [bike] = plan(bikeThreshold, {}).segments;
    const first = bike.items[0] as SuuntoStep;
    expect(first.target).toBeNull();
    expect(first.notes).toEqual(["Objectif prévu : 55–70 % FTP"]);
    expect(bike.warnings).toEqual(["FTP vélo non renseignée : les objectifs en % FTP ou en zones de puissance restent sans valeur en watts."]);
  });

  it("natation : distances, allure par 100 m, départs et matériel à côté", () => {
    const [swim] = plan(swimCss).segments;
    const steps = swim.items.flatMap((item) => (item.kind === "step" ? [item] : item.steps));
    expect(steps.every((s) => s.end.kind === "distance")).toBe(true);
    const work = steps.find((s) => s.phase === "Intervalle")!;
    expect(work.end.text).toBe("100 m");
    expect(work.target).toEqual({ kind: "pace", value: "1:38–1:42 /100 m" });
    expect(work.notes).toContain("Départ toutes les 1:50");
    expect(steps.some((s) => s.notes.some((n) => n.startsWith("Matériel : pull-buoy")))).toBe(true);
  });

  it("enchaînement : une partie par discipline, à créer chacune à part", () => {
    const parts = plan(brick).segments;
    expect(parts.map((p) => p.sport)).toEqual(["bike", "run"]);
    expect(parts[1].warnings).toContain("Enchaînement : chaque partie se crée comme un entraînement Suunto à part, à lancer l'une après l'autre.");
  });

  it("répétitions imbriquées déroulées, durée libre et renforcement au bouton tour, types sans équivalent nommés", () => {
    const input: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "run",
          sport: "run",
          steps: [
            { kind: "step", id: "d", type: "drill", label: "", length: { unit: "open" }, targets: [{ metric: "rpe", unit: "scale", min: 3, max: 4 }] },
            {
              kind: "repeat",
              id: "outer",
              count: 2,
              label: "Série",
              steps: [
                { kind: "repeat", id: "inner", count: 3, steps: [{ kind: "step", id: "f", type: "active", length: { unit: "distance", meters: 200 }, targets: [{ metric: "pace", unit: "percent_threshold", min: 110, max: 115 }] }] },
                { kind: "step", id: "r", type: "rest", length: { unit: "time", seconds: 120 } },
              ],
            },
          ],
        },
        {
          id: "gym",
          sport: "strength",
          steps: [{ kind: "step", id: "s", type: "active", label: "Squats", length: { unit: "reps", reps: 12 } }],
        },
      ],
    };
    const [run, gym] = plan(input).segments;
    const drill = run.items[0] as SuuntoStep;
    expect(drill).toMatchObject({ phase: "Intervalle", name: "Éducatifs", end: { kind: "lap", text: "Bouton tour" }, target: null, notes: ["Effort ressenti 3–4 sur 10"] });
    const serie = run.items[1] as SuuntoRepeat;
    expect(serie).toMatchObject({ count: 2, name: "Série" });
    // 3 × 200 m déroulés, puis le repos : quatre étapes dans la répétition de Suunto.
    expect(serie.steps.map((s) => [s.phase, s.name, s.end.text])).toEqual([
      ["Intervalle", null, "200 m"],
      ["Intervalle", null, "200 m"],
      ["Intervalle", null, "200 m"],
      ["Récupération", "Repos", "2 min"],
    ]);
    // 110–115 % de la vitesse au seuil de 4:00 /km : 3:29–3:38 /km.
    expect(serie.steps[0].target).toEqual({ kind: "pace", value: "3:29–3:38 /km" });
    expect(run.warnings).toContain("Répétition dans une répétition : elle est déroulée ici, pour n'avoir qu'un niveau de répétition à saisir.");
    expect(run.stepCount).toBe(5);
    expect(gym.items[0]).toMatchObject({ name: "Squats", end: { kind: "lap" }, notes: ["12 répétitions, puis bouton tour"] });
  });

  it("une seule cible par étape dans Suunto : la seconde est écrite à côté", () => {
    const input: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "b",
          sport: "bike",
          steps: [
            {
              kind: "step",
              id: "x",
              type: "active",
              length: { unit: "time", seconds: 600 },
              targets: [
                { metric: "heart_rate", unit: "zone", min: 2, max: 2 },
                { metric: "speed", unit: "kmh", min: 28.5, max: 31 },
              ],
            },
          ],
        },
      ],
    };
    const step = plan(input).segments[0].items[0] as SuuntoStep;
    expect(step.target?.kind).toBe("heart_rate");
    expect(step.target?.value).toMatch(/^\d+–\d+ bpm$/);
    expect(step.notes).toEqual(["Aussi : vitesse 28,5–31 km/h"]);
  });
});
