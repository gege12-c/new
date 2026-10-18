import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildActivityFit } from "../../../tests/fixtures/fit-files";
import { buildZip } from "../../../tests/fixtures/zip";
import { fitFilesFrom } from "./archive";
import { parseFitFile } from "./parse";

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fit = buildActivityFit({ start: new Date("2026-10-20T05:30:00Z"), sessions: [{ sport: "running", durationS: 1800, distanceM: 6000 }] });

describe("fichiers FIT compressés", () => {
  it("extrait les fichiers FIT d'une archive zip (Garmin Connect), stockés ou compressés", async () => {
    const zip = buildZip([
      { name: "12345_ACTIVITY.fit", data: fit },
      { name: "notes.txt", data: new TextEncoder().encode("ignoré") },
      { name: "dossier/autre.FIT", data: fit, method: 0 },
    ]);
    const files = await fitFilesFrom("export.zip", buffer(zip));
    expect(files.map((f) => f.name)).toEqual(["12345_ACTIVITY.fit", "autre.FIT"]);
    const [activity] = await parseFitFile(files[0].data);
    expect(activity).toMatchObject({ sport: "run", elapsed_s: 1800, distance_m: 6000 });
    expect(new Uint8Array(files[1].data)).toEqual(fit);
  });

  it("décompresse un .fit.gz (export Strava) et laisse un .fit tel quel", async () => {
    const files = await fitFilesFrom("course.fit.gz", buffer(new Uint8Array(gzipSync(fit))));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("course.fit");
    expect(new Uint8Array(files[0].data)).toEqual(fit);
    expect((await fitFilesFrom("course.fit", buffer(fit)))[0].data.byteLength).toBe(fit.byteLength);
  });

  it("refuse une archive sans fichier FIT ou endommagée", async () => {
    await expect(fitFilesFrom("vide.zip", buffer(buildZip([{ name: "a.txt", data: new Uint8Array([1, 2]) }])))).rejects.toThrow(/Aucun fichier FIT/);
    const broken = buildZip([{ name: "a.fit", data: fit }]).slice(0, 40);
    await expect(fitFilesFrom("casse.zip", buffer(broken))).rejects.toThrow(/illisible/);
  });
});
