import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/planning/dates";
import { measureTrend } from "./trends";
import type { WellnessEntry } from "./wellness";

const today = "2026-10-31";
const entry = (entry_date: string, values: Partial<WellnessEntry>): WellnessEntry => ({
  entry_date,
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

describe("tendances des mesures du matin", () => {
  it("moyenne des 7 jours comparée à la zone habituelle des 60 jours d'avant", () => {
    // 60 jours de VFC entre 55 et 65 ms, puis une semaine à 45 ms.
    const history = Array.from({ length: 60 }, (_, i) => entry(addDays(today, -(66 - i)), { hrv_ms: i % 2 ? 55 : 65 }));
    const recent = Array.from({ length: 7 }, (_, i) => entry(addDays(today, -i), { hrv_ms: 45 }));
    const trend = measureTrend([...history, ...recent], "hrv_ms", today);
    expect(trend.band).toEqual({ low: 55, high: 65, mean: 60 });
    expect(trend.recent).toBe(45);
    expect(trend.status).toBe("below");
    expect(trend.last).toBe(45);
    expect(trend.days).toHaveLength(90);
  });

  it("trop peu de jours : ni zone habituelle ni verdict ; zone jamais plus étroite qu'un minimum", () => {
    const few = measureTrend([entry(addDays(today, -1), { resting_hr: 48 }), entry(today, { resting_hr: 47 })], "resting_hr", today);
    expect(few).toMatchObject({ band: null, recent: null, status: null, known: 2, last: 47 });
    // Deux mois d'une FC au repos parfaitement régulière : zone de ±2 bpm au moins.
    const steady = Array.from({ length: 67 }, (_, i) => entry(addDays(today, -i), { resting_hr: 46 }));
    expect(measureTrend(steady, "resting_hr", today)).toMatchObject({ band: { low: 44, high: 48 }, status: "within" });
  });
});
