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

  it("garde les courbes réduites et les tours de la montre, sans la trace GPS", async () => {
    const records = Array.from({ length: 1201 }, (_, t) => ({
      offsetS: t,
      power: t >= 300 && t < 600 ? 300 : 180,
      heartRate: 140,
      speed: 9.5,
      cadence: 88,
      altitude: 210,
      distance: t * 9.5,
    }));
    const file = buildActivityFit({
      start: new Date("2026-10-22T06:00:00Z"),
      sessions: [
        {
          sport: "cycling",
          durationS: 1200,
          distanceM: 11400,
          records,
          laps: [
            { offsetS: 0, durationS: 300, avgPower: 180, intensity: "warmup" },
            { offsetS: 300, durationS: 300, avgPower: 300, avgHr: 152, intensity: "active" },
            { offsetS: 600, durationS: 600, avgPower: 180, intensity: "rest" },
          ],
        },
      ],
    });
    const [activity] = await parseFitFile(buffer(file));
    const streams = activity.streams!;
    expect(streams.sample_s).toBe(2);
    expect(Object.keys(streams.series).sort()).toEqual(["altitude", "cadence", "distance", "heartrate", "speed", "time", "watts"]);
    expect(streams.series.time).toHaveLength(601);
    expect(streams.series.watts![200]).toBe(300);
    expect(streams.series.altitude![0]).toBe(210);
    expect(streams.laps.map((l) => [l.start_s, l.duration_s, l.avg_power, l.kind, l.label])).toEqual([
      [0, 300, 180, null, "Échauffement"],
      [300, 300, 300, "work", null],
      [600, 600, 180, "recovery", null],
    ]);
    expect(streams.laps_origin).toBe("device");
    expect(streams.bests).toMatchObject({ "5": 300, "60": 300, "300": 300 });
    // Puissance normalisée au-dessus de la moyenne (fractionné), FC quadratique égale à la FC constante.
    expect(streams.metrics?.np).toBeGreaterThan(Math.round((300 * 300 + 901 * 180) / 1201));
    expect(streams.metrics?.hr_rms).toBe(140);
    expect(streams.metrics?.ngs).toBeUndefined();
    expect(ImportBatchSchema.safeParse([activity]).success).toBe(true);
    // Le résumé seul, sans mesure au fil de la séance : pas de courbe.
    const bare = buildActivityFit({ start: new Date("2026-10-22T06:00:00Z"), sessions: [{ sport: "running", durationS: 600 }] });
    expect((await parseFitFile(buffer(bare)))[0].streams).toBeNull();
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
