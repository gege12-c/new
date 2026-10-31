import { describe, expect, it } from "vitest";
import type { ServerSupabase } from "@/lib/supabase/server";
import { getSessionDetail, getSessionsInRange } from "./planning";

const WORKOUT = { schemaVersion: 1, segments: [{ id: "s1", sport: "bike", steps: [{ kind: "step", id: "a", type: "active", length: { unit: "time", seconds: 600 }, targets: [] }] }] };
const ROW = {
  id: "s1",
  athlete_id: "a1",
  scheduled_date: "2026-11-02",
  start_time: null,
  sport: "bike",
  title: "Endurance",
  objective: null,
  planned_duration_s: 600,
  planned_distance_m: null,
  state: "published",
  version: 1,
  created_by: "c1",
  content: WORKOUT,
  description: null,
  nutrition_notes: null,
  published_at: null,
  updated_at: "2026-10-31T10:00:00Z",
  template_id: null,
};

/**
 * Client Supabase minimal : une lecture qui demande les colonnes des séances reprises d'intervals.icu
 * échoue comme sur une base pas encore à jour (code 42703), ou avec l'erreur donnée.
 */
function fakeClient(options: { lagging?: boolean; error?: { code: string; message: string } } = {}) {
  const selects: string[] = [];
  const client = {
    from() {
      let columns = "";
      let single = false;
      const builder = {
        select(value: string) {
          columns = value;
          selects.push(value);
          return builder;
        },
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        maybeSingle() {
          single = true;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          if (options.error) return resolve({ data: null, error: options.error });
          if (options.lagging && columns.includes("source")) return resolve({ data: null, error: { code: "42703", message: "column planned_sessions.source does not exist" } });
          const row = columns.includes("source") ? { ...ROW, source: "intervals", import_notes: ["Note"] } : ROW;
          return resolve({ data: single ? row : [row], error: null });
        },
      };
      return builder;
    },
  };
  return { supabase: client as unknown as ServerSupabase, selects };
}

describe("lecture des séances, base en avance ou en retard sur le code", () => {
  it("lit la source des séances quand la base est à jour", async () => {
    const { supabase, selects } = fakeClient();
    const [session] = await getSessionsInRange(supabase, "a1", "2026-11-02", "2026-11-08");
    expect(session).toMatchObject({ id: "s1", source: "intervals", import_notes: ["Note"] });
    expect(selects).toHaveLength(1);
    expect(await getSessionDetail(supabase, "s1")).toMatchObject({ source: "intervals", import_notes: ["Note"] });
  });

  it("base pas encore à jour : les séances se lisent comme avant, toutes de TriCoach", async () => {
    const { supabase, selects } = fakeClient({ lagging: true });
    const [session] = await getSessionsInRange(supabase, "a1", "2026-11-02", "2026-11-08", { withPending: true });
    expect(session).toMatchObject({ id: "s1", source: "tricoach", title: "Endurance" });
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("source");
    expect(selects[1]).toContain("pending:planned_session_drafts");
    expect(await getSessionDetail(supabase, "s1")).toMatchObject({ id: "s1", source: "tricoach", description: null });
  });

  it("une autre erreur n'est pas masquée", async () => {
    const { supabase, selects } = fakeClient({ error: { code: "42501", message: "permission denied" } });
    await expect(getSessionsInRange(supabase, "a1", "2026-11-02", "2026-11-08")).rejects.toMatchObject({ code: "42501" });
    expect(selects).toHaveLength(1);
  });
});
