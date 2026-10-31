import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "./schema-version";

describe("version du schéma attendue par le contrôle de production", () => {
  it("est celle de la dernière migration du dépôt", () => {
    const files = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.at(-1)?.slice(0, 14)).toBe(LATEST_MIGRATION);
  });
});
