import { describe, expect, it } from "vitest";
import { currentThresholds, formatThresholdValue, parsePace, thresholdDef, toAthleteThresholds } from "./thresholds";
import { safeNextPath } from "./utils";

describe("seuils", () => {
  it("lit une allure au format min:s", () => {
    expect(parsePace("4:35")).toBe(275);
    expect(parsePace(" 1:05 ")).toBe(65);
    expect(parsePace("90")).toBe(90);
    expect(parsePace("4:75")).toBeNull();
    expect(parsePace("abc")).toBeNull();
  });

  it("retient la valeur en vigueur à la date demandée", () => {
    const rows = [
      { sport: "bike", metric: "ftp_w", value: 250, effective_from: "2026-01-10" },
      { sport: "bike", metric: "ftp_w", value: 265, effective_from: "2026-06-01" },
      { sport: "bike", metric: "ftp_w", value: 280, effective_from: "2026-12-01" },
      { sport: "swim", metric: "css_s_per_100m", value: 98, effective_from: "2026-03-01" },
    ];
    const current = currentThresholds(rows, "2026-08-15");
    expect(current.get("bike.ftp_w")?.value).toBe(265);
    const thresholds = toAthleteThresholds(current);
    expect(thresholds.bike?.ftpW).toBe(265);
    expect(thresholds.swim?.cssSPer100m).toBe(98);
    expect(thresholds.run?.thresholdPaceSPerKm).toBeUndefined();
  });

  it("formate les valeurs avec leur unité", () => {
    expect(formatThresholdValue(thresholdDef("run", "threshold_pace_s_per_km")!, 250)).toBe("4:10 /km");
    expect(formatThresholdValue(thresholdDef("general", "weight_kg")!, 71.5)).toBe("71,5 kg");
  });
});

describe("redirections", () => {
  it("n'autorise que des chemins internes", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("https://evil.example")).toBe("/home");
    expect(safeNextPath("//evil.example")).toBe("/home");
    expect(safeNextPath("/\\evil.example")).toBe("/home");
    expect(safeNextPath(null)).toBe("/home");
  });
});
