import { describe, expect, it } from "vitest";
import { bikeThreshold, brick, swimCss } from "@/lib/workout/fixtures";
import { WorkoutSchema, type WorkoutInput } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { buildGuides, externalIdFor, GuideSchema, inGuideWindow, type GuideContext, type SuuntoGuide } from "./guide";
import { packGuide, pngSize, readZip } from "./zip";

const thresholds: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 165 },
  run: { thresholdPaceSPerKm: 240, lthrBpm: 172 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};

const SESSION = "0b6f9d3c-2f4e-4c1a-9a57-3d2c1b0a9e8f";
const ctx = (overrides: Partial<GuideContext> = {}): GuideContext => ({
  sessionId: SESSION,
  title: "Seuil 4 × 8 min",
  description: null,
  nutrition: null,
  date: "2026-11-02",
  url: `https://tricoach.example/athlete/calendar?session=${SESSION}`,
  owner: "TriCoach",
  thresholds,
  ...overrides,
});
const build = (input: WorkoutInput, overrides: Partial<GuideContext> = {}) => buildGuides(WorkoutSchema.parse(input), ctx(overrides));
type Steps = SuuntoGuide["steps"];
const fieldsOf = (steps: Steps, i: number) => (steps[i].type === "fields" ? steps[i].fields : []);

describe("séance TriCoach → guide SuuntoPlus", () => {
  it("vélo au seuil : cibles en watts, décomptes, répétition, un tour par étape et l'étape Fin", () => {
    const [bike] = build(bikeThreshold, { description: "Rester assis.\n\nBien boire.", nutrition: "1 bidon/h" });
    expect(bike.issues.filter((i) => i.severity !== "info")).toEqual([]);
    const guide = bike.guide!;
    expect(guide).toMatchObject({
      type: "sequence",
      name: "Seuil 4 × 8 min",
      description: "Rester assis. Bien boire.. Nutrition : 1 bidon/h",
      shortDescription: "Vélo, 1 h 09",
      owner: "TriCoach",
      usage: "workout",
      localDate: "2026-11-02",
      externalId: `tricoach-${SESSION}-0`,
    });
    expect(GuideSchema.safeParse(guide).success).toBe(true);
    const [warmup, repeat, cooldown, end] = guide.steps;
    expect(warmup).toEqual({
      type: "fields",
      title: "Échauffement",
      transitions: [{ condition: { type: "stepDuration", value: 900 } }],
      fields: [
        { type: "targetPower", title: "CIBLE", value: 157, min: 138, max: 175 },
        { type: "power", title: "PUIS" },
        { type: "stepDurationCountdown", title: "RESTE", value: 900 },
        { type: "heartRate", title: "FC" },
      ],
      notification: { title: "Échauffement", text: "15 min · 138-175 W" },
    });
    expect(repeat.type).toBe("repeat");
    if (repeat.type !== "repeat") throw new Error("répétition attendue");
    expect(repeat.times).toBe(4);
    const [work, recovery] = repeat.steps;
    // Cadence de pédalage : deuxième cible, en hertz.
    expect(work.fields).toEqual([
      { type: "targetPower", title: "CIBLE", value: 244, min: 238, max: 250 },
      { type: "power", title: "PUIS" },
      { type: "stepDurationCountdown", title: "RESTE", value: 480 },
      { type: "targetCadence", title: "CIBLE 2", value: 1.5, min: 1.417, max: 1.583 },
    ]);
    expect(work.notification).toEqual({ title: "Travail", text: "8 min · 238-250 W · 85-95 rpm" });
    expect(recovery.fields[0]).toEqual({ type: "targetPower", title: "CIBLE", value: 69, min: 0, max: 138 });
    // Un tour au début de chaque étape qui suit un passage automatique (la première n'en a pas besoin).
    expect([warmup, work, recovery, cooldown, end].map((s) => ("createManualLap" in s ? s.createManualLap : undefined))).toEqual([
      undefined,
      true,
      true,
      true,
      true,
    ]);
    expect(end).toMatchObject({ title: "Fin", fields: [{ type: "text", value: "Séance terminée" }, { type: "duration", window: "workout" }] });
    expect(bike.manifest).toEqual({ name: "Seuil 4 × 8 min", type: "sequence", owner: "TriCoach", description: guide.description });
  });

  it("natation : distances, allure en m/s (borne basse = la plus lente), départ et matériel rappelés", () => {
    const [swim] = build(swimCss, { title: "CSS 8 × 100" });
    const steps = swim.guide!.steps;
    expect(steps[0]).toMatchObject({ transitions: [{ condition: { type: "stepDistance", value: 400 } }] });
    // Sans cible : l'allure en direct, le décompte de distance, la FC.
    expect(fieldsOf(steps, 0)).toEqual([
      { type: "pace", title: "ALLURE" },
      { type: "stepDistanceCountdown", title: "RESTE", value: 400 },
      { type: "heartRate", title: "FC" },
    ]);
    const main = steps[1];
    if (main.type !== "repeat") throw new Error("répétition attendue");
    expect(main.times).toBe(8);
    const hundred = main.steps[0];
    // 98–102 % de la CSS (1:40 /100 m) : 1:38 à 1:42 /100 m, soit 0,98 à 1,02 m/s.
    expect(hundred.fields[0]).toEqual({ type: "targetPace", title: "CIBLE", value: 1, min: 0.98, max: 1.02 });
    expect(hundred.fields.at(-1)).toEqual({ type: "text", value: "Départ toutes les 1:50" });
    expect(hundred.notification?.text).toBe("100 m · 1:38-1:42 /100 m · Départ toutes les 1:50");
    expect(swim.issues).toContainEqual({
      severity: "loss",
      where: "Étape 2, Travail",
      message: "Départ toutes les 1:50 : la montre ne le décompte pas, il est rappelé à l'écran de l'étape.",
    });
    expect(fieldsOf(steps, 2).at(-1)).toEqual({ type: "text", value: "Matériel : pull-buoy" });
  });

  it("enchaînement : un guide par discipline, identifiants externes distincts", () => {
    const parts = build(brick, { title: "Enchaînement du samedi" });
    expect(parts.map((p) => [p.sport, p.externalId, p.guide?.name])).toEqual([
      ["bike", externalIdFor(SESSION, 0), "Enchaînement du samedi (1/2 vélo)"],
      ["run", externalIdFor(SESSION, 1), "Enchaînement du samedi (2/2 course à pied)"],
    ]);
    expect(parts[1].issues).toContainEqual({ severity: "info", message: "Enchaînement : un guide par discipline, à lancer l'un après l'autre sur la montre." });
    const run = parts[1].guide!.steps;
    // 4:30–4:40 /km : 3,571 à 3,704 m/s.
    expect(fieldsOf(run, 1)[0]).toEqual({ type: "targetPace", title: "CIBLE", value: 3.638, min: 3.571, max: 3.704 });
  });

  it("sans seuil, rien n'est deviné : la cible est rappelée à l'écran et signalée", () => {
    const [bike] = build(bikeThreshold, { thresholds: {} });
    const warmup = bike.guide!.steps[0];
    if (warmup.type !== "fields") throw new Error("étape attendue");
    expect(warmup.fields).toEqual([
      { type: "speed", title: "VIT" },
      { type: "stepDurationCountdown", title: "RESTE", value: 900 },
      { type: "heartRate", title: "FC" },
      { type: "text", value: "55-70 % FTP" },
    ]);
    expect(bike.issues).toContainEqual({
      severity: "loss",
      where: "Étape 1, Échauffement",
      message: "55–70 % FTP : sans FTP vélo enregistrée, cible non convertible (rappelée à l'écran de l'étape).",
    });
  });

  it("répétitions imbriquées déroulées, renforcement au bouton tour, RPE et cadence de course rappelés", () => {
    const input: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "run",
          sport: "run",
          steps: [
            {
              kind: "step",
              id: "d",
              type: "drill",
              length: { unit: "open" },
              targets: [
                { metric: "rpe", unit: "scale", min: 3, max: 4 },
                { metric: "cadence", unit: "spm", min: 170, max: 180 },
              ],
            },
            {
              kind: "repeat",
              id: "outer",
              count: 2,
              steps: [
                { kind: "repeat", id: "inner", count: 3, steps: [{ kind: "step", id: "f", type: "active", length: { unit: "distance", meters: 200 } }] },
                { kind: "step", id: "r", type: "rest", length: { unit: "time", seconds: 120 } },
              ],
            },
          ],
        },
        { id: "gym", sport: "strength", steps: [{ kind: "step", id: "s", type: "active", label: "Squats", length: { unit: "reps", reps: 12 } }] },
      ],
    };
    const [run, gym] = build(input);
    const [drill, serie] = run.guide!.steps;
    expect(drill).toMatchObject({
      title: "Éducatifs",
      transitions: [{ condition: { type: "manualLap" } }],
      fields: [{ type: "pace" }, { type: "duration", window: "step" }, { type: "heartRate" }, { type: "text", value: "RPE 3-4/10" }],
      notification: { text: "durée libre · RPE 3-4/10 · 170-180 pas/min" },
    });
    expect(run.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        "Effort ressenti (RPE) : la montre ne le mesure pas, il est rappelé à l'écran de l'étape.",
        "170–180 pas/min : cadence de course non transmise (pas ou foulées selon les montres), rappelée à l'écran de l'étape.",
        "Répétition dans une répétition : déroulée dans la répétition qui la contient (la montre n'a qu'un niveau de répétition).",
      ]),
    );
    if (serie.type !== "repeat") throw new Error("répétition attendue");
    // 3 × 200 m déroulés puis le repos : quatre étapes dans l'unique niveau de répétition.
    expect(serie.times).toBe(2);
    expect(serie.steps.map((s) => s.transitions?.[0].condition)).toEqual([
      { type: "stepDistance", value: 200 },
      { type: "stepDistance", value: 200 },
      { type: "stepDistance", value: 200 },
      { type: "stepDuration", value: 120 },
    ]);
    const squats = gym.guide!.steps[0];
    expect(squats).toMatchObject({
      title: "Squats",
      transitions: [{ condition: { type: "manualLap" } }],
      fields: [{ type: "heartRate" }, { type: "duration", window: "step" }, { type: "text", value: "12 répétitions" }],
    });
  });

  it("textes de montre : titres de 13 caractères, consignes raccourcies et signalées, caractères simples", () => {
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
              label: "Montée en force “assis” 🚴",
              notes: "Garder le buste immobile, mains en haut du cintre, et respirer calmement tout du long de l’effort…",
              length: { unit: "time", seconds: 300 },
            },
          ],
        },
      ],
    };
    const [part] = build(input, { title: "Force — côte de Laguiole" });
    const step = part.guide!.steps[0];
    if (step.type !== "fields") throw new Error("étape attendue");
    expect(step.title).toBe("Montée en...");
    expect(step.fields.at(-1)).toEqual({ type: "text", value: 'Montée en force "assis"' });
    expect(step.notification!.text.length).toBeLessThanOrEqual(54);
    expect(part.guide!.name).toBe("Force - côte de Laguiole");
    expect(part.issues).toContainEqual({
      severity: "loss",
      where: "Étape 1, Montée en force “assis” 🚴",
      message: "Consignes raccourcies sur la montre (54 caractères à l'écran) : le texte complet reste dans TriCoach.",
    });
  });

  it("plus de 1 000 étapes une fois déroulées : envoi impossible, expliqué", () => {
    const block = (id: string, count: number, size: number) => ({
      kind: "repeat" as const,
      id,
      count,
      steps: Array.from({ length: size }, (_, i) => ({ kind: "step" as const, id: `${id}-${i}`, type: "active" as const, length: { unit: "time" as const, seconds: 30 } })),
    });
    const [part] = build({ schemaVersion: 1, segments: [{ id: "r", sport: "run", steps: [{ kind: "repeat", id: "all", count: 1, steps: [block("a", 100, 6), block("b", 100, 5)] }] }] });
    expect(part.guide).toBeNull();
    expect(part.issues.at(-1)).toMatchObject({ severity: "blocking", message: expect.stringContaining("Plus de 1000 étapes") });
  });

  it("modes sportifs Suunto facultatifs, par discipline", () => {
    expect(build(bikeThreshold, { activities: { bike: [2] } })[0].guide!.activities).toEqual([2]);
    expect(build(bikeThreshold, { activities: { run: [1] } })[0].guide!.activities).toBeUndefined();
  });

  it("fenêtre d'envoi : aujourd'hui et les 6 jours suivants", () => {
    expect(inGuideWindow("2026-10-31", "2026-10-31")).toBe(true);
    expect(inGuideWindow("2026-11-06", "2026-10-31")).toBe(true);
    expect(inGuideWindow("2026-11-07", "2026-10-31")).toBe(false);
    expect(inGuideWindow("2026-10-30", "2026-10-31")).toBe(false);
  });
});

describe("paquet du guide", () => {
  it("archive zip lisible : manifest.json, guide.json et une icône PNG de 300 × 300", () => {
    const [bike] = build(bikeThreshold);
    const zip = packGuide(bike.guide!, bike.manifest!);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "guide.json", "icon.png"]);
    const text = (i: number) => new TextDecoder().decode(entries[i].data);
    expect(JSON.parse(text(0))).toEqual(bike.manifest);
    expect(JSON.parse(text(1))).toEqual(bike.guide);
    expect(pngSize(entries[2].data)).toEqual({ width: 300, height: 300 });
  });

  it("une archive abîmée est refusée à la relecture", () => {
    const [bike] = build(bikeThreshold);
    const zip = packGuide(bike.guide!, bike.manifest!);
    // Un octet du contenu de manifest.json (après l’en-tête local de 30 octets et le nom de 13 caractères).
    zip[45] ^= 0xff;
    expect(() => readZip(zip)).toThrow(/CRC/);
  });
});
