import { Decoder, Stream } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { bikeThreshold, brick, swimCss } from "@/lib/workout/fixtures";
import { WorkoutSchema, type Segment, type WorkoutInput } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import { compatibilityReports, exportSegment } from "./connectors";
import { buildFitWorkout, clipUtf8, validateFitWorkout } from "./fit-workout";
import { workoutSheet } from "./sheet";
import { safeFileName, type ExportContext } from "./types";
import { parseXml } from "./xml";
import { buildZwo, validateZwo } from "./zwo";

const thresholds: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 165 },
  run: { thresholdPaceSPerKm: 250, lthrBpm: 172 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};
const ctx = (title = "Seuil 4 × 8 min", t: AthleteThresholds | undefined = thresholds): ExportContext => ({
  title,
  thresholds: t,
  now: new Date("2026-10-19T06:00:00Z"),
  serialNumber: 424242,
});
const segments = (input: WorkoutInput): Segment[] => WorkoutSchema.parse(input).segments;
const single = (input: WorkoutInput) => segments(input)[0];

function decodeSteps(bytes: Uint8Array) {
  const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(bytes))).read();
  expect(errors).toEqual([]);
  return { fileId: messages.fileIdMesgs![0], workout: messages.workoutMesgs![0], steps: messages.workoutStepMesgs! as Record<string, unknown>[] };
}

function blocks(xml: string) {
  const root = parseXml(xml);
  return root.children.find((c) => c.name === "workout")!.children;
}

function segment(sport: Segment["sport"], steps: unknown[]): Segment {
  return single({ schemaVersion: 1, segments: [{ id: "s", sport, steps }] } as WorkoutInput);
}

describe("une même séance produit un .zwo et un FIT valides", () => {
  const bike = single(bikeThreshold);

  it("écrit les deux fichiers, relus sans erreur, avec la même durée totale", () => {
    const zwo = exportSegment("zwift", bike, ctx());
    const fit = exportSegment("garmin", bike, ctx());
    expect(zwo.ok && fit.ok).toBe(true);
    if (!zwo.ok || !fit.ok) return;
    expect(zwo.file.fileName).toBe("Seuil-4-8-min.zwo");
    expect(fit.file.fileName).toBe("Seuil-4-8-min.fit");

    const zwoCheck = validateZwo(new TextDecoder().decode(zwo.file.bytes));
    const fitCheck = validateFitWorkout(fit.file.bytes);
    expect(zwoCheck).toMatchObject({ ok: true, errors: [] });
    expect(fitCheck).toMatchObject({ ok: true, errors: [] });
    // 15 min + 4 × (8 + 3) min + 10 min = 69 min.
    expect(zwoCheck.summary?.total).toBe(4140);
    expect(fitCheck.summary?.timeSeconds).toBe(4140);
  });

  it("Zwift : rampes d'échauffement et de retour au calme, intervalles en un bloc", () => {
    const result = buildZwo(bike, ctx());
    const [warmup, intervals, cooldown] = blocks(result.xml!);
    expect(warmup).toMatchObject({ name: "Warmup", attributes: { Duration: "900", PowerLow: "0.55", PowerHigh: "0.7" } });
    expect(intervals).toMatchObject({
      name: "IntervalsT",
      attributes: { Repeat: "4", OnDuration: "480", OffDuration: "180", OnPower: "0.975", Cadence: "90" },
    });
    // Zone 1 (0–55 % FTP) : le haut de la plage, 44–55 %, soit 49,5 %.
    expect(intervals.attributes.OffPower).toBe("0.495");
    expect(cooldown).toMatchObject({ name: "Cooldown", attributes: { Duration: "600", PowerLow: "0.6", PowerHigh: "0.5" } });
    expect(result.issues.map((i) => i.message).join("\n")).toMatch(/Cadence 85–95 tr\/min ramenée à 90/);
    expect(result.issues.some((i) => i.severity === "info" && /Coggan/.test(i.message))).toBe(true);
  });

  it("FIT : séance (et non activité), cibles en % FTP, cadence secondaire, répétition", () => {
    const result = buildFitWorkout(bike, ctx());
    const { fileId, workout, steps } = decodeSteps(result.bytes!);
    expect(fileId).toMatchObject({ type: "workout", manufacturer: "development", serialNumber: 424242 });
    expect(workout).toMatchObject({ wktName: "Seuil 4 × 8 min", sport: "cycling", numValidSteps: 5 });
    expect(steps[0]).toMatchObject({ intensity: "warmup", durationType: "time", durationTime: 900, targetType: "power", customTargetValueLow: 55, customTargetValueHigh: 70 });
    expect(steps[1]).toMatchObject({
      intensity: "active",
      durationTime: 480,
      customTargetValueLow: 95,
      customTargetValueHigh: 100,
      secondaryTargetType: "cadence",
      secondaryCustomTargetValueLow: 85,
      secondaryCustomTargetValueHigh: 95,
    });
    // Zone 1 → plage de % FTP du modèle de Coggan.
    expect(steps[2]).toMatchObject({ intensity: "recovery", customTargetValueLow: 0, customTargetValueHigh: 55 });
    expect(steps[3]).toMatchObject({ durationType: "repeatUntilStepsCmplt", durationStep: 1, repeatSteps: 4, targetType: "open" });
    expect(steps[4]).toMatchObject({ intensity: "cooldown", durationTime: 600 });
  });
});

describe("ZwiftExporter", () => {
  it("refuse la natation", () => {
    const result = exportSegment("zwift", single(swimCss), ctx("Natation"));
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ severity: "blocking" });
  });

  it("course : allures en fraction de l'allure de référence, transition retirée", () => {
    const run = segments(brick)[1];
    const result = buildZwo(run, ctx("Enchaînement"));
    expect(result.xml).toContain("<sportType>run</sportType>");
    expect(result.xml).toContain("<durationType>time</durationType>");
    const list = blocks(result.xml!);
    expect(list).toHaveLength(1);
    // 4:30–4:40 /km avec un seuil à 4:10 /km : 89,3–92,6 % de la vitesse seuil.
    expect(list[0]).toMatchObject({ name: "SteadyState", attributes: { Duration: "1200", Power: "0.909", pace: "2" } });
    expect(result.issues.some((i) => /Transition non exportée/.test(i.message))).toBe(true);
    expect(result.issues.some((i) => /allure 10 km/.test(i.message))).toBe(true);
    expect(validateZwo(result.xml!).ok).toBe(true);
  });

  it("course en distance : durationType distance, durées en mètres", () => {
    const run = segment("run", [
      { kind: "step", id: "a", type: "warmup", length: { unit: "distance", meters: 2000 } },
      {
        kind: "step",
        id: "b",
        type: "active",
        length: { unit: "distance", meters: 1000 },
        targets: [{ metric: "pace", unit: "percent_threshold", min: 100, max: 104 }],
      },
    ]);
    const result = buildZwo(run, ctx("Allure"));
    expect(result.xml).toContain("<durationType>distance</durationType>");
    const [easy, work] = blocks(result.xml!);
    expect(easy.attributes).toMatchObject({ Duration: "2000", Power: "0.8" });
    expect(work.attributes).toMatchObject({ Duration: "1000", Power: "1.02" });
    expect(result.issues.some((i) => i.severity === "loss" && /80 % de l'allure de référence/.test(i.message))).toBe(true);
  });

  it("bloque une étape de travail de course sans allure, au lieu d'inventer une intensité", () => {
    const run = segment("run", [
      { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 600 }, targets: [{ metric: "heart_rate", unit: "zone", min: 2, max: 2 }] },
    ]);
    const result = exportSegment("zwift", run, ctx("FC"));
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.severity === "blocking")?.message).toMatch(/ajoutez une cible d'allure/);
  });

  it("allure absolue sans allure seuil : export bloqué avec la marche à suivre", () => {
    const run = segments(brick)[1];
    const blocked = exportSegment("zwift", run, ctx("Enchaînement", { bike: { ftpW: 250 } }));
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.find((i) => i.severity === "blocking")?.message).toMatch(/enregistrez l'allure seuil/);
    // Garmin, lui, accepte l'allure absolue telle quelle.
    expect(exportSegment("garmin", run, ctx("Enchaînement", { bike: { ftpW: 250 } })).ok).toBe(true);
  });

  it("watts sans FTP : sortie libre, perte signalée", () => {
    const bike = segment("bike", [
      { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 300 }, targets: [{ metric: "power", unit: "watts", min: 200, max: 220 }] },
    ]);
    const result = buildZwo(bike, ctx("Watts", {}));
    expect(blocks(result.xml!)[0]).toMatchObject({ name: "FreeRide", attributes: { Duration: "300" } });
    expect(result.issues.some((i) => i.severity === "loss" && /sans FTP/.test(i.message))).toBe(true);
    const withFtp = buildZwo(bike, ctx("Watts"));
    expect(blocks(withFtp.xml!)[0].attributes.Power).toBe("0.84");
  });

  it("déroule les répétitions qui ne sont pas un simple travail / récupération", () => {
    const bike = segment("bike", [
      {
        kind: "repeat",
        id: "r",
        count: 2,
        steps: [
          { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 60 }, targets: [{ metric: "power", unit: "percent_ftp", min: 120, max: 120 }] },
          { kind: "step", id: "b", type: "active", length: { unit: "time", seconds: 60 }, targets: [{ metric: "power", unit: "percent_ftp", min: 100, max: 100 }] },
          { kind: "step", id: "c", type: "recovery", length: { unit: "time", seconds: 120 }, targets: [{ metric: "power", unit: "percent_ftp", min: 50, max: 50 }] },
        ],
      },
    ]);
    const result = buildZwo(bike, ctx("Over-under"));
    expect(blocks(result.xml!).map((b) => b.attributes.Power)).toEqual(["1.2", "1", "0.5", "1.2", "1", "0.5"]);
    expect(validateZwo(result.xml!).summary?.total).toBe(480);
  });

  it("échappe le texte et affiche les consignes pendant l'étape", () => {
    const bike = segment("bike", [
      {
        kind: "step",
        id: "a",
        type: "active",
        length: { unit: "time", seconds: 300 },
        notes: "Rester assis <vraiment> & souple",
        targets: [{ metric: "power", unit: "percent_ftp", min: 90, max: 90 }],
      },
    ]);
    const result = buildZwo(bike, ctx("Tempo & force <PMA>"));
    expect(result.xml).toContain("<name>Tempo &amp; force &lt;PMA&gt;</name>");
    const [block] = blocks(result.xml!);
    expect(block.children[0]).toMatchObject({ name: "textevent", attributes: { timeoffset: "0", message: "Rester assis <vraiment> & souple" } });
  });

  it("la relecture refuse un fichier incohérent", () => {
    expect(validateZwo("<workout_file><name>x</name><sportType>bike</sportType><workout><Sprint Duration='5'/></workout></workout_file>").ok).toBe(false);
    expect(validateZwo("<workout_file><name>x</name><sportType>bike</sportType><workout><SteadyState Duration='60' Power='12'/></workout></workout_file>").errors[0]).toMatch(/Power invalide/);
    expect(validateZwo("<workout_file><name>x").ok).toBe(false);
  });
});

describe("GarminConnector (FIT de séance)", () => {
  it("natation : distances, allure CSS en vitesse, matériel, répétition", () => {
    const result = exportSegment("garmin", single(swimCss), ctx("CSS 8 × 100"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { workout, steps } = decodeSteps(result.file.bytes);
    expect(workout).toMatchObject({ sport: "swimming", subSport: "lapSwimming", numValidSteps: 4 });
    expect(steps[0]).toMatchObject({ durationType: "distance", durationDistance: 400, targetType: "open" });
    // 98–102 % de la CSS (1 m/s) : 0,98 à 1,02 m/s.
    expect(steps[1]).toMatchObject({ durationDistance: 100, targetType: "speed", customTargetSpeedLow: 0.98, customTargetSpeedHigh: 1.02 });
    expect(String(steps[1].notes)).toContain("Départ toutes les 1:50");
    expect(steps[2]).toMatchObject({ durationType: "repeatUntilStepsCmplt", durationStep: 1, repeatSteps: 8 });
    expect(steps[3]).toMatchObject({ equipment: "swimPullBuoy", intensity: "cooldown" });
    expect(validateFitWorkout(result.file.bytes).summary?.distanceMeters).toBe(1400);
    expect(result.issues.some((i) => i.severity === "loss" && /Départ/.test(i.message))).toBe(true);
  });

  it("sans CSS enregistrée : la cible relative est signalée perdue, jamais inventée", () => {
    const result = buildFitWorkout(single(swimCss), ctx("CSS", {}));
    const { steps } = decodeSteps(result.bytes!);
    expect(steps[1].targetType).toBe("open");
    expect(result.issues.some((i) => i.severity === "loss" && /sans CSS/.test(i.message))).toBe(true);
  });

  it("FC : bpm décalés de 100, % FC max bruts, % du seuil convertis avec la FC seuil", () => {
    const run = segment("run", [
      { kind: "step", id: "a", type: "warmup", length: { unit: "time", seconds: 600 }, targets: [{ metric: "heart_rate", unit: "bpm", min: 120, max: 135 }] },
      { kind: "step", id: "b", type: "active", length: { unit: "time", seconds: 600 }, targets: [{ metric: "heart_rate", unit: "percent_max_hr", min: 80, max: 85 }] },
      { kind: "step", id: "c", type: "active", length: { unit: "time", seconds: 600 }, targets: [{ metric: "heart_rate", unit: "percent_lthr", min: 95, max: 100 }] },
      { kind: "step", id: "d", type: "cooldown", length: { unit: "open" }, targets: [{ metric: "rpe", unit: "scale", min: 2, max: 3 }] },
    ]);
    const result = buildFitWorkout(run, ctx("FC"));
    const { steps } = decodeSteps(result.bytes!);
    expect(steps[0]).toMatchObject({ targetType: "heartRate", customTargetValueLow: 220, customTargetValueHigh: 235 });
    expect(steps[1]).toMatchObject({ customTargetValueLow: 80, customTargetValueHigh: 85 });
    // 95–100 % de 172 bpm = 163–172 bpm.
    expect(steps[2]).toMatchObject({ customTargetValueLow: 263, customTargetValueHigh: 272 });
    expect(steps[3]).toMatchObject({ durationType: "open", targetType: "open", notes: "RPE 2–3" });
    expect(validateFitWorkout(result.bytes!).ok).toBe(true);
  });

  it("répétitions imbriquées : la répétition extérieure est gardée, l'intérieure déroulée", () => {
    const bike = segment("bike", [
      {
        kind: "repeat",
        id: "outer",
        count: 3,
        steps: [
          {
            kind: "repeat",
            id: "inner",
            count: 2,
            steps: [
              { kind: "step", id: "on", type: "active", length: { unit: "time", seconds: 30 }, targets: [{ metric: "power", unit: "percent_ftp", min: 150, max: 150 }] },
              { kind: "step", id: "off", type: "recovery", length: { unit: "time", seconds: 30 } },
            ],
          },
          { kind: "step", id: "rest", type: "rest", length: { unit: "time", seconds: 180 } },
        ],
      },
    ]);
    const result = buildFitWorkout(bike, ctx("30/30"));
    const { steps } = decodeSteps(result.bytes!);
    expect(steps.map((s) => s.durationType)).toEqual(["time", "time", "time", "time", "time", "repeatUntilStepsCmplt"]);
    expect(steps[5]).toMatchObject({ durationStep: 0, repeatSteps: 3 });
    expect(validateFitWorkout(result.bytes!).summary?.timeSeconds).toBe(3 * (2 * 60 + 180));
    // Zwift déroule tout (récupération sans cible : pas de bloc IntervalsT) : 3 × (2 × 2 + 1) blocs.
    expect(blocks(buildZwo(bike, ctx("30/30")).xml!)).toHaveLength(15);
  });

  it("la relecture détecte un fichier abîmé", () => {
    const result = buildFitWorkout(single(bikeThreshold), ctx());
    const damaged = result.bytes!.slice();
    damaged[damaged.length - 10] ^= 0xff;
    expect(validateFitWorkout(damaged).ok).toBe(false);
    expect(validateFitWorkout(new TextEncoder().encode("pas un fichier")).ok).toBe(false);
  });

  it("raccourcit les textes trop longs pour le format FIT et le signale", () => {
    // « é » fait 2 octets, « … » 3 : 3 lettres + points de suspension = 9 octets.
    expect(clipUtf8("é".repeat(10), 9)).toEqual({ text: "ééé…", clipped: true });
    expect(clipUtf8("court", 9)).toEqual({ text: "court", clipped: false });
    const long = segment("bike", [
      { kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 60 }, notes: "Consigne très détaillée. ".repeat(40) },
    ]);
    const result = buildFitWorkout(long, ctx());
    const { steps } = decodeSteps(result.bytes!);
    expect(new TextEncoder().encode(String(steps[0].notes)).length).toBeLessThanOrEqual(250);
    expect(result.issues.some((i) => i.severity === "loss" && /Notes raccourcies/.test(i.message))).toBe(true);
  });
});

describe("rapports de compatibilité", () => {
  it("un enchaînement donne un fichier par discipline et par fournisseur", () => {
    const reports = compatibilityReports(segments(brick), ctx("Enchaînement"));
    expect(reports.map((r) => [r.provider, r.sport, r.ok, r.fileName])).toEqual([
      ["zwift", "bike", true, "Enchainement-1-bike.zwo"],
      ["zwift", "run", true, "Enchainement-2-run.zwo"],
      ["garmin", "bike", true, "Enchainement-1-bike.fit"],
      ["garmin", "run", true, "Enchainement-2-run.fit"],
    ]);
  });

  it("noms de fichiers sûrs", () => {
    expect(safeFileName("Séance « VMA » 10 × 400 m", "fit")).toBe("Seance-VMA-10-400-m.fit");
    expect(safeFileName("///", "zwo")).toBe("seance.zwo");
  });
});

describe("fiche texte", () => {
  it("détaille les étapes avec les valeurs absolues quand les seuils le permettent", () => {
    const sheet = workoutSheet(WorkoutSchema.parse(bikeThreshold), { title: "Seuil 4 × 8 min", thresholds, description: "Boire toutes les 15 min." });
    expect(sheet.split("\n")).toEqual([
      "Seuil 4 × 8 min",
      "",
      "Vélo — Seuil 4 × 8 min",
      "1. 15 min — Échauffement — 138–175 W (55–70 % FTP)",
      "2. 4 fois :",
      "   - 8 min — Travail — 238–250 W (95–100 % FTP) — 85–95 rpm",
      "   - 3 min — Récupération — 0–138 W (Z1 puissance)",
      "3. 10 min — Retour au calme — 125–150 W (50–60 % FTP)",
      "",
      "Consignes :",
      "Boire toutes les 15 min.",
    ]);
  });
});
