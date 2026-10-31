import { describe, expect, it } from "vitest";
import type { LinkedActivity } from "@/lib/activities/realization";
import type { CalendarActivity } from "@/lib/data/planning-types";
import { teamWeek, type TeamSession } from "./team-week";

const activity = (id: string, athlete: string, date: string, extra: Partial<LinkedActivity> = {}): LinkedActivity => ({
  id,
  athlete_id: athlete,
  source: "intervals",
  external_id: id,
  sport: "run",
  sport_detail: null,
  name: null,
  start_time: `${date}T06:00:00Z`,
  local_date: date,
  local_start_time: "07:00",
  elapsed_s: 2700,
  moving_s: 2400,
  distance_m: 8000,
  elevation_gain_m: null,
  avg_hr: null,
  max_hr: null,
  avg_power: null,
  weighted_power: null,
  avg_speed_mps: null,
  trainer: null,
  device_name: null,
  expires_at: null,
  links: [],
  ...extra,
});

const session = (id: string, athlete: string, date: string, extra: Partial<TeamSession> = {}): TeamSession => ({
  id,
  athlete_id: athlete,
  scheduled_date: date,
  start_time: null,
  sport: "bike",
  title: `Séance ${id}`,
  state: "published",
  planned_duration_s: 3600,
  planned_distance_m: null,
  realization: { attached: [], proposals: [], completion: null },
  ...extra,
});

describe("semaine de tous les athlètes", () => {
  it("jour par jour : séances et leur état, activités hors programme, jours indisponibles, totaux", () => {
    const done = activity("a1", "u1", "2026-11-02", { sport: "bike", moving_s: 3500, links: [{ session_id: "s1", status: "auto" }] });
    const rows = teamWeek({
      athletes: [
        { id: "u1", name: "Léa" },
        { id: "u2", name: "Tom" },
      ],
      sessions: [
        session("s1", "u1", "2026-11-02", { realization: { attached: [done as CalendarActivity], proposals: [], completion: null } }),
        session("s2", "u1", "2026-11-03"),
        session("s3", "u1", "2026-11-05", { state: "draft" }),
        session("s4", "u1", "2026-11-06", { state: "cancelled" }),
        session("s5", "u2", "2026-11-04"),
      ],
      activities: [done, activity("a2", "u1", "2026-11-04"), activity("a3", "u1", "2026-11-04", { source: "strava" })],
      notes: [
        { id: "n1", athlete_id: "u2", kind: "travel", start_date: "2026-11-05", end_date: "2026-11-09", title: "Rotation Tokyo", note: null, created_by: "u2" },
        { id: "n2", athlete_id: "u2", kind: "note", start_date: "2026-11-02", end_date: "2026-11-02", title: "Rappel", note: null, created_by: "u2" },
      ],
      monday: "2026-11-02",
      today: "2026-11-04",
    });
    const [lea, tom] = rows;
    expect(lea.cells.map((c) => c.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(lea.cells[0].sessions[0]).toMatchObject({ id: "s1", status: "done", draft: false });
    expect(lea.cells[1].sessions[0].status).toBe("unreconciled");
    expect(lea.cells[3].sessions[0]).toMatchObject({ draft: true, status: "draft" });
    expect(lea.cells[4].sessions).toEqual([]);
    // Hors programme : la sortie de mercredi (Strava : jamais comptée).
    expect(lea.cells[2].extra).toEqual([{ id: "a2", sport: "run", durationS: 2400 }]);
    expect(lea).toMatchObject({ plannedS: 7200, realizedS: 3500 + 2400, drafts: 1, missed: 0 });
    expect(tom.cells[3].away).toBe("Déplacement : Rotation Tokyo");
    expect(tom.cells[0].away).toBeNull();
    expect(tom.cells[2].sessions[0].status).toBe("planned");
  });
});
