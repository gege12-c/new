import { describe, expect, it } from "vitest";
import { validateFitWorkout } from "@/lib/export/fit-workout";
import { bikeThreshold, brick } from "@/lib/workout/fixtures";
import { watchDayLabel, watchFitFile, watchSummary, WatchDataSchema, type WatchData } from "./sessions";

const session = (id: string, date: string, title: string, sport: "bike" | "brick", content: unknown) => ({
  id,
  scheduled_date: date,
  start_time: null,
  sport,
  title,
  description: "Rester assis dans les montées.",
  nutrition_notes: null,
  content,
  planned_duration_s: 3600,
  planned_distance_m: null,
  version: 3,
});

const IDS = {
  bike: "00000000-0000-4000-8000-000000000001",
  broken: "00000000-0000-4000-8000-000000000002",
  brick: "00000000-0000-4000-8000-000000000003",
};

const raw = {
  status: "ok",
  device: { id: "00000000-0000-4000-8000-0000000000aa", name: "Forerunner 965" },
  athlete: { id: "00000000-0000-4000-8000-0000000000bb", name: "Gérald", timezone: "Europe/Paris" },
  today: "2026-10-19",
  sessions: [
    session(IDS.bike, "2026-10-19", "L’exercice du jour : seuil 4 × 8 min, avec une très longue consigne de titre", "bike", bikeThreshold),
    session(IDS.broken, "2026-10-20", "Séance abîmée", "bike", { schemaVersion: 1, segments: "rien" }),
    session(IDS.brick, "2026-10-21", "Enchaînement", "brick", brick),
  ],
  thresholds: [
    { sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-01" },
    { sport: "run", metric: "threshold_pace_s_per_km", value: 240, effective_from: "2026-01-01" },
  ],
};

const data = (() => {
  const parsed = WatchDataSchema.parse(raw);
  if (parsed.status !== "ok") throw new Error("fixture");
  return parsed as WatchData;
})();

describe("montre Garmin : séances servies", () => {
  it("lit la réponse de la base ; un jeton refusé est reconnu", () => {
    expect(WatchDataSchema.parse({ status: "unauthorized" })).toEqual({ status: "unauthorized" });
    expect(() => WatchDataSchema.parse({ ...raw, sessions: [{ id: "x" }] })).toThrow();
  });

  it("nomme les jours comme la montre les affiche", () => {
    expect(watchDayLabel("2026-10-19", "2026-10-19")).toBe("Aujourd'hui");
    expect(watchDayLabel("2026-10-20", "2026-10-19")).toBe("Demain");
    expect(watchDayLabel("2026-10-21", "2026-10-19")).toBe("Mer. 21");
  });

  it("résume chaque séance pour l'écran : titre court, parties téléchargeables", () => {
    const summary = watchSummary(data);
    expect(summary.athlete).toBe("Gérald");
    expect(summary.sessions.map((s) => [s.day, s.sport, s.parts.length])).toEqual([
      ["Aujourd'hui", "bike", 1],
      ["Demain", "bike", 0],
      ["Mer. 21", "brick", 2],
    ]);
    const [bike, , combined] = summary.sessions;
    expect(bike.title.length).toBeLessThanOrEqual(40);
    expect(bike.title).toMatch(/^L'exercice du jour/);
    expect(bike.title.endsWith("…")).toBe(true);
    expect(bike.parts).toEqual([{ index: 0, sport: "bike", ok: true }]);
    expect(combined.parts.map((p) => [p.sport, p.ok])).toEqual([
      ["bike", true],
      ["run", true],
    ]);
    // Le résumé reste petit : la mémoire d'un widget de montre est comptée.
    expect(JSON.stringify(summary).length).toBeLessThan(1500);
  });

  it("sert un vrai fichier FIT de séance, relu par le SDK, partie par partie", () => {
    const bike = watchFitFile(data, IDS.bike, 0);
    expect(bike.ok).toBe(true);
    if (!bike.ok) return;
    const checked = validateFitWorkout(bike.bytes);
    expect(checked.errors).toEqual([]);
    expect(checked.summary?.sport).toBe("cycling");

    const run = watchFitFile(data, IDS.brick, 1);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(validateFitWorkout(run.bytes).summary?.sport).toBe("running");
    expect(run.fileName).toMatch(/2-run\.fit$/);

    expect(watchFitFile(data, IDS.brick, 5)).toMatchObject({ ok: false, status: 404 });
    expect(watchFitFile(data, "00000000-0000-4000-8000-0000000000ff", 0)).toMatchObject({ ok: false, status: 404 });
    expect(watchFitFile(data, IDS.broken, 0)).toMatchObject({ ok: false, status: 422 });
  });
});
