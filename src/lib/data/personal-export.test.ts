import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/auth/dal";
import { buildPersonalExport } from "./personal-export";

type Table = unknown[] | { error: { code: string; message: string } };

/** Client Supabase minimal : chaque table renvoie ses lignes, ou une erreur. */
function fakeSession(tables: Record<string, Table>): Session {
  const client = {
    from(table: string) {
      const entry = tables[table] ?? [];
      let single = false;
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: () => {
          single = true;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          if (!Array.isArray(entry)) return resolve({ data: null, error: entry.error });
          return resolve({ data: single ? (entry[0] ?? null) : entry, error: null });
        },
      };
      return builder;
    },
  };
  return { supabase: client as unknown as Session["supabase"], userId: "u1", email: "a@b.fr" };
}

describe("export des données personnelles", () => {
  it("rassemble les rubriques et écarte les rapprochements avec une activité Strava", async () => {
    const result = await buildPersonalExport(
      fakeSession({
        profiles: [{ id: "u1", display_name: "Léa" }],
        activities: [{ id: "fit-1", source: "fit_upload" }],
        session_activity_matches: [
          { activity_id: "fit-1", session_id: "s1" },
          { activity_id: "strava-1", session_id: "s2" },
        ],
      }),
      new Date("2026-10-19T05:00:00Z"),
    );
    expect(result).toMatchObject({ format: "tricoach-personal-data", version: 1, exported_at: "2026-10-19T05:00:00.000Z", email: "a@b.fr", unavailable: [] });
    expect(result.data.account).toEqual({ id: "u1", display_name: "Léa" });
    expect(result.data.activity_matches).toEqual([{ activity_id: "fit-1", session_id: "s1" }]);
    expect(result.data.notification_settings).toBeNull();
    expect(result.notes.some((note) => note.includes("Strava"))).toBe(true);
  });

  it("signale une rubrique absente de la base au lieu d'échouer, mais pas une vraie erreur", async () => {
    const missing = { error: { code: "PGRST205", message: "Could not find the table" } };
    const partial = await buildPersonalExport(fakeSession({ notifications: missing, workout_exports: missing }));
    expect(partial.unavailable.sort()).toEqual(["exports", "notifications"]);
    expect(partial.data.notifications).toBeNull();
    await expect(buildPersonalExport(fakeSession({ planned_sessions: { error: { code: "42501", message: "permission denied" } } }))).rejects.toThrow(/sessions/);
  });
});
