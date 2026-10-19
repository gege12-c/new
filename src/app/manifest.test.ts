import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const PUBLIC = path.resolve(__dirname, "../../public");

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG. */
function pngSize(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("application installable", () => {
  const m = manifest();

  it("déclare ce qu'exigent Chrome et Safari pour l'installation", () => {
    expect(m).toMatchObject({ name: "TriCoach", short_name: "TriCoach", display: "standalone", start_url: "/home", scope: "/", lang: "fr" });
    const sizes = m.icons!.filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons!.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
  });

  it("chaque icône existe, au bon format et à la bonne taille", () => {
    for (const icon of m.icons!) {
      const [width, height] = icon.sizes!.split("x").map(Number);
      expect(pngSize(path.join(PUBLIC, icon.src))).toEqual({ width, height });
    }
  });

  it("le service worker ne met en cache que la page hors connexion", () => {
    const sw = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
    expect(sw).toContain('request.mode !== "navigate"');
    expect(sw).toContain('const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"]');
    expect(sw).not.toMatch(/cache\.put/);
    expect(readFileSync(path.join(PUBLIC, "offline.html"), "utf8")).toContain("Pas de connexion");
  });
});
