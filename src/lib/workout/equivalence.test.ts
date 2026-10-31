import { describe, expect, it } from "vitest";
import type { Target } from "./schema";
import { effortMetricFor, heartRateEquivalent, hrPercentOfThreshold, hrTargetAsEffort } from "./equivalence";
import type { AthleteThresholds } from "./zones";

const t: AthleteThresholds = { bike: { ftpW: 270, lthrBpm: 165 }, run: { thresholdPaceSPerKm: 300, lthrBpm: 180 } };
const target = (metric: Target["metric"], unit: string, min: number, max: number) => ({ metric, unit, min, max }) as Target;

describe("équivalence des zones théoriques", () => {
  it("course : la FC se convertit en allure, le vélo en puissance, la natation pas", () => {
    expect(effortMetricFor("run")).toBe("pace");
    expect(effortMetricFor("bike")).toBe("power");
    expect(effortMetricFor("swim")).toBeNull();
    expect(hrTargetAsEffort(target("heart_rate", "zone", 1, 1), "swim", t)).toBeNull();
  });

  it("une zone de FC donne la zone de même numéro", () => {
    expect(hrTargetAsEffort(target("heart_rate", "zone", 2, 3), "run", t)).toEqual({ metric: "pace", unit: "zone", min: 2, max: 3 });
    expect(hrTargetAsEffort(target("heart_rate", "zone", 4, 4), "bike", t)).toEqual({ metric: "power", unit: "zone", min: 4, max: 4 });
  });

  it("une plage de FC donne la même position dans les zones d'effort", () => {
    // Milieu de la zone 3 de FC course (90–94 %) → milieu de la zone 3 d'allure (88–94 %).
    expect(hrTargetAsEffort(target("heart_rate", "percent_lthr", 92, 92), "run", t)).toEqual({ metric: "pace", unit: "percent_threshold", min: 91, max: 91 });
    // Au seuil : 100 % de FC seuil ↔ 102 % de vitesse seuil (borne basse de la zone 5), 106 % de FTP au vélo.
    expect(hrTargetAsEffort(target("heart_rate", "percent_lthr", 100, 100), "run", t)).toMatchObject({ min: 102 });
    expect(hrTargetAsEffort(target("heart_rate", "percent_lthr", 100, 100), "bike", t)).toMatchObject({ unit: "percent_ftp", min: 106 });
    // bpm : rapportés à la FC seuil de la discipline ; sans elle, rien n'est converti.
    expect(hrTargetAsEffort(target("heart_rate", "bpm", 153, 160), "run", t)).toEqual({ metric: "pace", unit: "percent_threshold", min: 78, max: 86 });
    expect(hrTargetAsEffort(target("heart_rate", "bpm", 153, 160), "run", { run: { thresholdPaceSPerKm: 300 } })).toBeNull();
    // Au-delà des zones : bornées, rien d'extrapolé.
    expect(hrTargetAsEffort(target("heart_rate", "percent_lthr", 110, 115), "run", t)).toMatchObject({ min: 112, max: 112 });
  });

  it("allure ou puissance → FC correspondante, en bpm quand la FC seuil est connue", () => {
    // 6:45–7:45/km pour une allure seuil de 5:00/km : 65–74 % de la vitesse seuil, zone 1 de FC.
    expect(heartRateEquivalent(target("pace", "sec_per_km", 405, 465), "run", t)).toMatchObject({ bpm: { min: 106, max: 139 }, zones: { min: 1, max: 1 } });
    expect(heartRateEquivalent(target("power", "watts", 257, 270), "bike", t)?.zones).toEqual({ min: 4, max: 4 });
    // Sans FC seuil vélo : la FC est donnée en % de la FC seuil.
    const noLthr = heartRateEquivalent(target("power", "percent_ftp", 56, 75), "bike", { bike: { ftpW: 270 } });
    expect(noLthr).toMatchObject({ bpm: null, zones: { min: 2, max: 2 } });
    expect(noLthr?.percent.min).toBeCloseTo(81);
    expect(noLthr?.percent.max).toBeCloseTo(89.55, 1);
    // Sans allure seuil, une allure absolue ne se situe pas dans les zones.
    expect(heartRateEquivalent(target("pace", "sec_per_km", 300, 330), "run", { run: { lthrBpm: 180 } })).toBeNull();
  });

  it("plage de FC d'une cible : % du seuil, zones, bpm", () => {
    expect(hrPercentOfThreshold(target("heart_rate", "zone", 2, 2), "run", t)).toEqual({ min: 85, max: 89 });
    expect(hrPercentOfThreshold(target("heart_rate", "bpm", 90, 180), "run", t)).toEqual({ min: 50, max: 100 });
    expect(hrPercentOfThreshold(target("heart_rate", "percent_max_hr", 80, 80), "run", t)).toBeNull();
  });
});
