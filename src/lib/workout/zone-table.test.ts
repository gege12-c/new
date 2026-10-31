import { describe, expect, it } from "vitest";
import { cssFromTests, ftpFromTwentyMinutes, zoneTables } from "./zone-table";

describe("zones d'entraînement en valeurs réelles", () => {
  it("puissance, FC et allures, ouvertes aux extrémités", () => {
    const tables = zoneTables({ bike: { ftpW: 250, lthrBpm: 160 }, run: { thresholdPaceSPerKm: 250 }, swim: { cssSPer100m: 98 } });
    expect(tables.map((t) => t.key)).toEqual(["bike.power", "bike.hr", "run.pace", "swim.pace"]);
    const power = tables[0];
    expect(power.basis).toBe("FTP 250 W");
    expect(power.rows[0]).toEqual({ zone: 1, label: "Récupération active", range: "moins de 138 W" });
    expect(power.rows[1].range).toBe("140 à 188 W");
    expect(power.rows[3].range).toBe("228 à 263 W");
    expect(power.rows[6].range).toBe("plus de 378 W");
    expect(tables[1].rows[1].range).toBe("130 à 142 bpm");
    const run = tables[2];
    expect(run.basis).toBe("allure seuil 4:10 /km");
    expect(run.rows[3].range).toBe("4:23 à 4:08 /km");
    expect(run.rows[0].range).toBe("plus lent que 5:25 /km");
    expect(run.rows[4].range).toBe("plus vite que 4:05 /km");
    expect(tables[3].rows[3].range).toMatch(/\/100 m$/);
  });

  it("sans seuil, pas de table", () => {
    expect(zoneTables({})).toEqual([]);
    expect(zoneTables({ general: { maxHrBpm: 190 } })).toEqual([]);
  });
});

describe("calculs de seuil depuis un test", () => {
  it("FTP : 95 % de la puissance moyenne sur 20 minutes", () => {
    expect(ftpFromTwentyMinutes(250)).toBe(238);
    expect(ftpFromTwentyMinutes(5)).toBeNull();
    expect(ftpFromTwentyMinutes(Number.NaN)).toBeNull();
  });

  it("CSS : (400 m − 200 m) / 2", () => {
    expect(cssFromTests(6 * 60 + 20, 3 * 60 + 2)).toBe(99);
    expect(cssFromTests(180, 200)).toBeNull();
    expect(cssFromTests(900, 100)).toBeNull();
  });
});
