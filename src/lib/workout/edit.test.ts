import { describe, expect, it } from "vitest";
import {
  addSegment,
  appendNode,
  canWrapInRepeat,
  collectIds,
  defaultWorkout,
  duplicateNode,
  makeStep,
  moveNode,
  nodeAt,
  removeNode,
  removeSegment,
  setSegmentSport,
  unwrapRepeat,
  updateStep,
  wrapInRepeat,
} from "./edit";
import { formatDurationInput, parseDistance, parseDuration, parsePace, parseNumber } from "./inputs";
import { SPORT_TARGETS, SESSION_SPORTS, WorkoutSchema, type Workout } from "./schema";
import { bikeThreshold } from "./fixtures";

const valid = (w: Workout) => WorkoutSchema.safeParse(w).success;

describe("édition des séances", () => {
  it("propose une séance de départ valide pour chaque discipline", () => {
    for (const sport of SESSION_SPORTS) expect(valid(defaultWorkout(sport))).toBe(true);
    expect(defaultWorkout("brick").segments.map((s) => s.sport)).toEqual(["bike", "run"]);
  });

  it("ajoute, déplace, duplique et supprime sans casser les identifiants", () => {
    let w = WorkoutSchema.parse(bikeThreshold);
    w = appendNode(w, [0], makeStep("bike", "active", collectIds(w)));
    expect(w.segments[0].steps).toHaveLength(4);
    w = moveNode(w, [0, 3], -1);
    expect(nodeAt(w, [0, 3]).id).toBe("cd");
    w = duplicateNode(w, [0, 1]);
    expect(w.segments[0].steps[2].kind).toBe("repeat");
    expect(valid(w)).toBe(true);
    const before = collectIds(w).size;
    w = removeNode(w, [0, 2]);
    expect(collectIds(w).size).toBeLessThan(before);
    expect(valid(w)).toBe(true);
  });

  it("supprime une répétition vidée, mais jamais le dernier bloc d'un segment", () => {
    let w = WorkoutSchema.parse(bikeThreshold);
    w = removeNode(w, [0, 1, 0]);
    w = removeNode(w, [0, 1, 0]);
    expect(w.segments[0].steps.map((n) => n.id)).toEqual(["wu", "cd"]);
    w = removeNode(removeNode(w, [0, 1]), [0, 0]);
    expect(w.segments[0].steps).toHaveLength(1);
  });

  it("emboîte et déroule les répétitions dans la limite de profondeur", () => {
    let w = WorkoutSchema.parse(bikeThreshold);
    w = wrapInRepeat(w, [0, 1]);
    expect(nodeAt(w, [0, 1])).toMatchObject({ kind: "repeat", count: 2 });
    w = wrapInRepeat(w, [0, 1]);
    expect(canWrapInRepeat(w, [0, 1])).toBe(false);
    expect(wrapInRepeat(w, [0, 1])).toBe(w);
    expect(valid(w)).toBe(true);
    w = unwrapRepeat(unwrapRepeat(w, [0, 1]), [0, 1]);
    expect(nodeAt(w, [0, 1])).toMatchObject({ kind: "repeat", count: 4 });
  });

  it("modifie une étape et gère les segments d'un enchaînement", () => {
    let w = updateStep(WorkoutSchema.parse(bikeThreshold), [0, 0], { length: { unit: "time", seconds: 1200 } });
    expect(nodeAt(w, [0, 0])).toMatchObject({ length: { seconds: 1200 } });
    w = addSegment(w, "run");
    expect(w.segments[1].steps[0]).toMatchObject({ type: "transition" });
    expect(valid(w)).toBe(true);
    w = removeSegment(w, 1);
    expect(w.segments).toHaveLength(1);
    expect(removeSegment(w, 0)).toBe(w);
  });

  it("retire et compte les cibles impossibles quand la discipline change", () => {
    const allowed = (sport: keyof typeof SPORT_TARGETS, key: string) => SPORT_TARGETS[sport].includes(key);
    const { workout, removedTargets } = setSegmentSport(WorkoutSchema.parse(bikeThreshold), 0, "swim", allowed);
    // Puissance et cadence n'existent pas en natation : 3 étapes × 1 cible + 1 cadence.
    expect(removedTargets).toBe(5);
    expect(valid(workout)).toBe(true);
  });
});

describe("saisie des valeurs", () => {
  it("lit les durées sous plusieurs formes", () => {
    expect(parseDuration("45")).toBe(2700);
    expect(parseDuration("4:30")).toBe(270);
    expect(parseDuration("1:30:00")).toBe(5400);
    expect(parseDuration("90 s")).toBe(90);
    expect(parseDuration("1,5 h")).toBe(5400);
    expect(parseDuration("1h30")).toBe(5400);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0")).toBeNull();
    expect(formatDurationInput(5400)).toBe("1:30:00");
    expect(formatDurationInput(270)).toBe("4:30");
  });

  it("lit les distances, allures et nombres à la française", () => {
    expect(parseDistance("400")).toBe(400);
    expect(parseDistance("1,5 km")).toBe(1500);
    expect(parseDistance("-3")).toBeNull();
    expect(parsePace("4:35")).toBe(275);
    expect(parsePace("4:75")).toBeNull();
    expect(parseNumber("92,5")).toBe(92.5);
    expect(parseNumber("9x")).toBeNull();
  });
});
