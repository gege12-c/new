import { describe, expect, it } from "vitest";
import {
  analyzeWorkout,
  computeTotals,
  describeTarget,
  expandWorkout,
  formatDuration,
  parseWorkout,
  resolveTarget,
  sessionSportOf,
  summarizeNodes,
  type AthleteThresholds,
  type Workout,
  type WorkoutInput,
} from "./index";
import { bikeThreshold, brick, swimCss } from "./fixtures";

const thresholds: AthleteThresholds = {
  bike: { ftpW: 250, lthrBpm: 160 },
  run: { thresholdPaceSPerKm: 240, lthrBpm: 170 },
  swim: { cssSPer100m: 100 },
  general: { maxHrBpm: 190 },
};

function parse(input: WorkoutInput): Workout {
  const result = parseWorkout(input);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data;
}

const clone = <T,>(value: T): T => structuredClone(value);

describe("validation", () => {
  it("accepte les séances d'exemple", () => {
    expect(parseWorkout(bikeThreshold).success).toBe(true);
    expect(parseWorkout(swimCss).success).toBe(true);
    expect(parseWorkout(brick).success).toBe(true);
  });

  it("refuse une cible dont la borne basse dépasse la borne haute", () => {
    const w = clone(bikeThreshold);
    const step = w.segments[0].steps[0];
    if (step.kind !== "step") throw new Error("fixture");
    step.targets = [{ metric: "power", unit: "percent_ftp", min: 80, max: 60 }];
    const result = parseWorkout(w);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].message).toMatch(/borne basse/);
  });

  it("refuse une unité incompatible avec la discipline", () => {
    const w = clone(swimCss);
    const step = w.segments[0].steps[0];
    if (step.kind !== "step") throw new Error("fixture");
    step.targets = [{ metric: "power", unit: "percent_ftp", min: 50, max: 60 }];
    const result = parseWorkout(w);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.some((e) => /non disponible en natation/.test(e.message))).toBe(true);
  });

  it("refuse une unité qui n'existe pas pour la métrique", () => {
    const w = clone(bikeThreshold);
    const step = w.segments[0].steps[0];
    if (step.kind !== "step") throw new Error("fixture");
    step.targets = [{ metric: "power", unit: "bpm", min: 100, max: 120 }];
    expect(parseWorkout(w).success).toBe(false);
  });

  it("refuse les identifiants en double et les champs inconnus", () => {
    const dup = clone(bikeThreshold);
    const step = dup.segments[0].steps[2];
    if (step.kind !== "step") throw new Error("fixture");
    step.id = "wu";
    expect(parseWorkout(dup).success).toBe(false);

    const extra = clone(bikeThreshold) as unknown as Record<string, unknown>;
    extra.notAField = true;
    expect(parseWorkout(extra).success).toBe(false);
  });

  it("limite la profondeur des répétitions imbriquées", () => {
    const leaf = { kind: "step", id: "leaf", type: "active", length: { unit: "time", seconds: 30 } } as const;
    const nest = (depth: number, id: number): WorkoutInput["segments"][number]["steps"][number] =>
      depth === 0 ? leaf : { kind: "repeat", id: `r${id}`, count: 2, steps: [nest(depth - 1, id + 1)] };
    const ok: WorkoutInput = { schemaVersion: 1, segments: [{ id: "s", sport: "run", steps: [nest(3, 1)] }] };
    const tooDeep: WorkoutInput = { schemaVersion: 1, segments: [{ id: "s", sport: "run", steps: [nest(4, 1)] }] };
    expect(parseWorkout(ok).success).toBe(true);
    expect(parseWorkout(tooDeep).success).toBe(false);
  });

  it("réserve le départ (send-off) à la natation en distance", () => {
    const w = clone(bikeThreshold);
    const step = w.segments[0].steps[0];
    if (step.kind !== "step") throw new Error("fixture");
    step.sendOffSeconds = 60;
    expect(parseWorkout(w).success).toBe(false);
  });

  it("déduit la discipline de la séance", () => {
    expect(sessionSportOf(parse(bikeThreshold))).toBe("bike");
    expect(sessionSportOf(parse(brick))).toBe("brick");
  });
});

describe("résolution des cibles", () => {
  it("convertit % FTP et zones de puissance en watts", () => {
    expect(resolveTarget({ metric: "power", unit: "percent_ftp", min: 95, max: 100 }, "bike", thresholds)).toEqual({
      ok: true,
      target: { metric: "power", unit: "watts", min: 238, max: 250 },
    });
    expect(resolveTarget({ metric: "power", unit: "zone", min: 2, max: 2 }, "bike", thresholds)).toEqual({
      ok: true,
      target: { metric: "power", unit: "watts", min: 140, max: 188 },
    });
  });

  it("signale le seuil manquant au lieu d'inventer une valeur", () => {
    expect(resolveTarget({ metric: "power", unit: "percent_ftp", min: 95, max: 100 }, "bike", {})).toEqual({
      ok: false,
      missing: "bike_ftp",
    });
    expect(resolveTarget({ metric: "pace", unit: "percent_threshold", min: 95, max: 100 }, "swim")).toEqual({
      ok: false,
      missing: "swim_css",
    });
  });

  it("convertit un % de vitesse seuil en allure (borne rapide en premier)", () => {
    expect(resolveTarget({ metric: "pace", unit: "percent_threshold", min: 95, max: 100 }, "run", thresholds)).toEqual({
      ok: true,
      target: { metric: "pace", unit: "sec_per_km", min: 240, max: 253 },
    });
  });

  it("utilise la FC seuil propre à chaque discipline", () => {
    const target = { metric: "heart_rate", unit: "percent_lthr", min: 90, max: 90 } as const;
    expect(resolveTarget(target, "bike", thresholds)).toMatchObject({ ok: true, target: { min: 144 } });
    expect(resolveTarget(target, "run", thresholds)).toMatchObject({ ok: true, target: { min: 153 } });
  });
});

describe("durée et distance", () => {
  it("additionne les durées exactes en tenant compte des répétitions", () => {
    const totals = computeTotals(parse(bikeThreshold), thresholds);
    expect(totals.duration).toEqual({ value: 900 + 4 * (480 + 180) + 600, status: "exact", unknownSteps: 0 });
    // Vélo sans cible de vitesse : distance inconnue, jamais devinée.
    expect(totals.distance.status).toBe("unknown");
  });

  it("utilise les départs en natation et estime le reste depuis la CSS", () => {
    const totals = computeTotals(parse(swimCss), thresholds);
    expect(totals.distance).toEqual({ value: 1400, status: "exact", unknownSteps: 0 });
    // 8 × 110 s (départs) + 600 m faciles à 85 % de la vitesse CSS (1 m/s) ≈ 705,9 s.
    expect(totals.duration.status).toBe("estimated");
    expect(totals.duration.value).toBeCloseTo(880 + 600 / 0.85, 1);
  });

  it("indique une durée partielle quand la CSS manque", () => {
    const totals = computeTotals(parse(swimCss), {});
    expect(totals.duration.status).toBe("partial");
    expect(totals.duration.value).toBe(880);
    expect(totals.duration.unknownSteps).toBe(2);
  });

  it("estime la distance d'un enchaînement par discipline", () => {
    const totals = computeTotals(parse(brick), thresholds);
    expect(totals.duration).toEqual({ value: 3600 + 120 + 1200, status: "exact", unknownSteps: 0 });
    expect(totals.bySport.run?.distanceMeters).toBeCloseTo(1200 * ((1000 / 270 + 1000 / 280) / 2), 3);
    expect(totals.distance.status).toBe("partial"); // le vélo n'a pas de cible de vitesse
  });

  it("déroule les répétitions dans l'ordre", () => {
    const flat = expandWorkout(parse(bikeThreshold));
    expect(flat.map((f) => f.step.id)).toEqual(["wu", "work", "rec", "work", "rec", "work", "rec", "work", "rec", "cd"]);
    expect(flat[3].iterations).toEqual([1]);
  });
});

describe("avertissements", () => {
  const codes = (w: WorkoutInput, t: AthleteThresholds | undefined = thresholds) =>
    analyzeWorkout(parse(w), t).map((i) => i.code);

  it("ne signale rien sur une séance cohérente", () => {
    expect(codes(bikeThreshold)).toEqual([]);
  });

  it("signale les seuils manquants", () => {
    expect(codes(bikeThreshold, {})).toContain("missing_threshold");
  });

  it("signale une récupération plus intense que l'effort", () => {
    const w = clone(bikeThreshold);
    const repeat = w.segments[0].steps[1];
    if (repeat.kind !== "repeat") throw new Error("fixture");
    const rec = repeat.steps[1];
    if (rec.kind !== "step") throw new Error("fixture");
    rec.targets = [{ metric: "power", unit: "percent_ftp", min: 100, max: 105 }];
    expect(codes(w)).toContain("recovery_harder_than_work");
  });

  it("signale un effort continu trop long au-dessus du seuil, sans modifier la séance", () => {
    const w = clone(bikeThreshold);
    const repeat = w.segments[0].steps[1];
    if (repeat.kind !== "repeat") throw new Error("fixture");
    const work = repeat.steps[0];
    if (work.kind !== "step") throw new Error("fixture");
    work.length = { unit: "time", seconds: 1800 };
    work.targets = [{ metric: "power", unit: "percent_ftp", min: 110, max: 115 }];
    const before = JSON.stringify(w);
    expect(codes(w)).toContain("sustained_high_intensity");
    expect(JSON.stringify(w)).toBe(before);
  });

  it("signale un échauffement trop intense et une transition hors enchaînement", () => {
    const w = clone(bikeThreshold);
    const wu = w.segments[0].steps[0];
    if (wu.kind !== "step") throw new Error("fixture");
    wu.targets = [{ metric: "power", unit: "percent_ftp", min: 95, max: 100 }];
    w.segments[0].steps.push({ kind: "step", id: "t", type: "transition", length: { unit: "time", seconds: 60 } });
    const found = codes(w);
    expect(found).toContain("intense_warmup");
    expect(found).toContain("transition_outside_brick");
    expect(codes(brick)).not.toContain("transition_outside_brick");
  });

  it("signale une cible cardiaque au-dessus de la FC max", () => {
    const w: WorkoutInput = {
      schemaVersion: 1,
      segments: [
        {
          id: "s",
          sport: "run",
          steps: [
            {
              kind: "step",
              id: "a",
              type: "active",
              length: { unit: "time", seconds: 120 },
              targets: [{ metric: "heart_rate", unit: "bpm", min: 185, max: 195 }],
            },
          ],
        },
      ],
    };
    expect(codes(w)).toContain("above_max_hr");
  });
});

describe("mise en forme", () => {
  it("formate durées et cibles en français", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(150)).toBe("2 min 30 s");
    expect(formatDuration(3900)).toBe("1 h 05");
    expect(describeTarget({ metric: "pace", unit: "sec_per_km", min: 270, max: 280 })).toBe("4:30–4:40 /km");
    expect(describeTarget({ metric: "pace", unit: "percent_threshold", min: 98, max: 102 }, "swim")).toBe(
      "98–102 % CSS",
    );
  });

  it("résume une séance en une ligne", () => {
    const w = parse(bikeThreshold);
    expect(summarizeNodes(w.segments[0].steps, "bike")).toBe(
      "Échauffement 15 min à 55–70 % FTP · 4 × (8 min à 95–100 % FTP / Récupération 3 min en Z1 puissance) · Retour au calme 10 min à 50–60 % FTP",
    );
  });
});
