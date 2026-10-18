import { describe, expect, it } from "vitest";
import { buildActivityFit } from "../../../tests/fixtures/fit-files";
import { ImportBatchSchema } from "@/lib/activities/schema";
import { fitSport, parseFitFile } from "./parse";

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("import FIT", () => {
  it("lit le résumé d'une sortie vélo, avec l'heure locale du fichier", async () => {
    const file = buildActivityFit({
      start: new Date("2026-10-20T05:30:00Z"),
      utcOffsetS: 7200,
      sessions: [{ sport: "cycling", subSport: "road", durationS: 3600, timerS: 3500, distanceM: 30000, avgHr: 142, avgPower: 205 }],
    });
    const [activity, ...rest] = await parseFitFile(buffer(file));
    expect(rest).toEqual([]);
    expect(activity).toMatchObject({
      sport: "bike",
      start_time: "2026-10-20T05:30:00.000Z",
      utc_offset_s: 7200,
      elapsed_s: 3600,
      moving_s: 3500,
      distance_m: 30000,
      avg_hr: 142,
      avg_power: 205,
      group_key: null,
      trainer: false,
    });
    expect(activity.external_id).toMatch(/^[0-9a-f]{64}:0$/);
    expect(ImportBatchSchema.safeParse([activity]).success).toBe(true);
  });

  it("découpe un fichier multisport par discipline, sans les transitions", async () => {
    const file = buildActivityFit({
      start: new Date("2026-10-21T07:00:00Z"),
      sessions: [
        { sport: "cycling", durationS: 3600, distanceM: 32000 },
        { sport: "transition", durationS: 120 },
        { sport: "running", durationS: 1200, distanceM: 4200 },
      ],
    });
    const items = await parseFitFile(buffer(file));
    expect(items.map((i) => i.sport)).toEqual(["bike", "run"]);
    expect(new Set(items.map((i) => i.group_key)).size).toBe(1);
    expect(items[0].group_key).toMatch(/^[0-9a-f]{64}$/);
    expect(items[1].external_id.endsWith(":2")).toBe(true);
  });

  it("refuse ce qui n'est pas une activité réalisée", async () => {
    const workout = buildActivityFit({ start: new Date(), type: "workout", sessions: [{ sport: "running", durationS: 600 }] });
    await expect(parseFitFile(buffer(workout))).rejects.toThrow(/pas une activité réalisée/);
    await expect(parseFitFile(new TextEncoder().encode("pas un fichier FIT").buffer as ArrayBuffer)).rejects.toThrow(/pas un fichier FIT/);
    const damaged = buildActivityFit({ start: new Date(), sessions: [{ sport: "running", durationS: 600 }] });
    damaged[damaged.length - 1] ^= 0xff;
    await expect(parseFitFile(buffer(damaged))).rejects.toThrow(/endommagé/);
  });

  it("classe les disciplines", () => {
    expect(fitSport("swimming", "lapSwimming")).toBe("swim");
    expect(fitSport("training", "strengthTraining")).toBe("strength");
    expect(fitSport("training", "yoga")).toBe("other");
    expect(fitSport("fitnessEquipment", "indoorCycling")).toBe("bike");
    expect(fitSport("transition", undefined)).toBeNull();
    expect(fitSport("walking", undefined)).toBe("other");
  });
});
