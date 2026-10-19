import { describe, expect, it } from "vitest";
import { currentThresholds, formatThresholdValue, parsePace, parseThresholdValue, thresholdDef, toAthleteThresholds } from "./thresholds";
import { safeNextPath } from "./utils";

describe("seuils", () => {
  it("lit une allure au format min:s", () => {
    expect(parsePace("4:35")).toBe(275);
    expect(parsePace(" 1:05 ")).toBe(65);
    expect(parsePace("4:75")).toBeNull();
    expect(parsePace("abc")).toBeNull();
    expect(parsePace("4h10")).toBeNull();
    // Un nombre seul est ambigu (4:10 ou 410 secondes ?) : refusé plutôt que deviné.
    expect(parsePace("410")).toBeNull();
    expect(parsePace("90")).toBeNull();
  });

  it("lit la valeur d'un seuil dans son unité", () => {
    const ftp = thresholdDef("bike", "ftp_w")!;
    const weight = thresholdDef("general", "weight_kg")!;
    const css = thresholdDef("swim", "css_s_per_100m")!;
    expect(parseThresholdValue(ftp, "275")).toBe(275);
    expect(parseThresholdValue(weight, "72,5")).toBe(72.5);
    expect(parseThresholdValue(weight, "72.5")).toBe(72.5);
    expect(parseThresholdValue(ftp, "275 W")).toBeNull();
    expect(parseThresholdValue(ftp, "0x1F")).toBeNull();
    expect(parseThresholdValue(css, "1:35")).toBe(95);
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
