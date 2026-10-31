import { describe, expect, it } from "vitest";
import { baseline, formatMeasure, wellnessFlags, WellnessFormSchema, type WellnessEntry } from "./wellness";

const day = (date: string, values: Partial<WellnessEntry> = {}): WellnessEntry => ({
  entry_date: date,
  sleep_hours: null,
  sleep_quality: null,
  fatigue: null,
  soreness: null,
  stress: null,
  motivation: null,
  resting_hr: null,
  hrv_ms: null,
  weight_kg: null,
  note: null,
  ...values,
});

describe("forme du jour", () => {
  it("formulaire : virgule française, champs vides à null, bornes expliquées", () => {
    const parsed = WellnessFormSchema.parse({ entry_date: "2026-11-02", fatigue: "4", sleep_hours: "7,5", weight_kg: "72,46", resting_hr: "" });
    expect(parsed).toMatchObject({ fatigue: 4, sleep_hours: 7.5, weight_kg: 72.5, resting_hr: null, stress: null, note: null });
    const tooHigh = WellnessFormSchema.safeParse({ entry_date: "2026-11-02", resting_hr: "200" });
    expect(tooHigh.success ? null : tooHigh.error.issues[0].message).toBe("FC au repos : 150 au plus.");
    const words = WellnessFormSchema.safeParse({ entry_date: "2026-11-02", weight_kg: "soixante" });
    expect(words.success ? null : words.error.issues[0].message).toBe("Poids : nombre attendu.");
    const empty = WellnessFormSchema.safeParse({ entry_date: "2026-11-02", fatigue: "", note: "  " });
    expect(empty.success ? null : empty.error.issues[0].message).toBe("Renseignez au moins une valeur.");
  });

  it("ce qui mérite l'attention du coach", () => {
    expect(wellnessFlags(day("2026-11-02", { fatigue: 4, sleep_hours: 5.5, motivation: 2, stress: 3 })).map((f) => f.text)).toEqual([
      "fatigué",
      "motivation faible",
      "nuit de 5 h 30",
    ]);
    expect(wellnessFlags(day("2026-11-02", { fatigue: 2, sleep_quality: 4, sleep_hours: 8 }))).toEqual([]);
  });

  it("FC au repos comparée à la moyenne de l'athlète, seulement avec 5 jours de référence", () => {
    const history = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"].map((d) => day(d, { resting_hr: 48 }));
    expect(baseline(history, "resting_hr", "2026-11-02")).toBe(48);
    expect(wellnessFlags(day("2026-11-02", { resting_hr: 55 }), history).map((f) => f.text)).toEqual(["FC au repos +7 bpm"]);
    expect(wellnessFlags(day("2026-11-02", { resting_hr: 55 }), history.slice(1))).toEqual([]);
  });

  it("mise en forme des mesures", () => {
    expect([formatMeasure("sleep_hours", 7.5), formatMeasure("weight_kg", 72.5), formatMeasure("resting_hr", 48)]).toEqual(["7 h 30", "72,5 kg", "48 bpm"]);
  });
});
