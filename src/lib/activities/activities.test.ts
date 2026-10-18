import { describe, expect, it } from "vitest";
import type { CalendarActivity, CalendarSession } from "@/lib/data/planning-types";
import { sessionStatus } from "@/lib/planning/status";
import { calendarHref, readCalendarQuery } from "@/lib/planning/calendar-query";
import { activityDuration, completionRatio, deviation, realizedTotals } from "./compare";
import { formatSignedDistance, formatSignedDuration, formatSignedPercent, formatSpeed } from "./format";
import { unattachedActivities, withRealization, type RealizedRange } from "./realization";

const activity = (id: string, fields: Partial<CalendarActivity> = {}): CalendarActivity => ({
  id,
  source: "strava",
  external_id: id,
  sport: "run",
  sport_detail: "Run",
  name: null,
  start_time: "2026-10-20T05:00:00.000Z",
  local_date: "2026-10-20",
  local_start_time: "07:00:00",
  elapsed_s: 3000,
  moving_s: 2700,
  distance_m: 9000,
  elevation_gain_m: null,
  avg_hr: null,
  max_hr: null,
  avg_power: null,
  weighted_power: null,
  avg_speed_mps: 3.333,
  trainer: false,
  device_name: null,
  expires_at: null,
  ...fields,
});

const planned = { state: "published" as const, scheduled_date: "2026-10-20", planned_duration_s: 3000, planned_distance_m: null };
const completion = (status: "done" | "partial" | "skipped") => ({ session_id: "s1", athlete_id: "a", status, rpe: 6, note: null, updated_at: "2026-10-20T10:00:00Z" });

describe("prévu et réalisé", () => {
  it("compte le temps en mouvement en endurance, le temps total en renforcement", () => {
    expect(activityDuration(activity("a"))).toBe(2700);
    expect(activityDuration(activity("a", { sport: "strength" }))).toBe(3000);
    expect(activityDuration(activity("a", { moving_s: null }))).toBe(3000);
    expect(realizedTotals([activity("a"), activity("b", { moving_s: 600, distance_m: null })])).toEqual({ durationS: 3300, distanceM: 9000 });
    // Rien de mesuré : rien n'est inventé.
    expect(realizedTotals([activity("a", { moving_s: null, elapsed_s: null, distance_m: null })])).toEqual({ durationS: null, distanceM: null });
  });

  it("calcule écarts et part du prévu, sans diviser par un prévu absent", () => {
    expect(deviation(3000, 2700)).toEqual({ delta: -300, percent: -10 });
    expect(deviation(null, 2700)).toBeNull();
    expect(deviation(3000, null)).toBeNull();
    expect(completionRatio({ planned_duration_s: 3000, planned_distance_m: null }, { durationS: 2700, distanceM: null })).toBe(0.9);
    expect(completionRatio({ planned_duration_s: null, planned_distance_m: 10000 }, { durationS: 2700, distanceM: 5000 })).toBe(0.5);
    expect(completionRatio({ planned_duration_s: null, planned_distance_m: null }, { durationS: 2700, distanceM: 5000 })).toBeNull();
  });

  it("déduit le statut : déclaration de l'athlète, sinon part réalisée", () => {
    const attached = (a: CalendarActivity[]) => ({ attached: a, proposals: [], completion: null });
    expect(sessionStatus({ ...planned, realization: attached([activity("a")]) }, "2026-10-21")).toBe("done");
    expect(sessionStatus({ ...planned, realization: attached([activity("a", { moving_s: 1200 })]) }, "2026-10-21")).toBe("partial");
    // Sans prévu comparable, une activité rattachée vaut séance faite.
    expect(sessionStatus({ ...planned, planned_duration_s: null, realization: attached([activity("a")]) }, "2026-10-21")).toBe("done");
    // La déclaration prime sur la mesure.
    expect(sessionStatus({ ...planned, realization: { attached: [activity("a")], proposals: [], completion: completion("partial") } }, "2026-10-21")).toBe("partial");
    expect(sessionStatus({ ...planned, realization: { attached: [], proposals: [], completion: completion("skipped") } }, "2026-10-21")).toBe("missed");
    // Une proposition n'est pas une réalisation.
    expect(sessionStatus({ ...planned, realization: { attached: [], proposals: [activity("a")], completion: null } }, "2026-10-21")).toBe("unreconciled");
    expect(sessionStatus({ ...planned, state: "cancelled", realization: attached([activity("a")]) }, "2026-10-21")).toBe("cancelled");
  });

  it("répartit associations, propositions et activités sans séance", () => {
    const sessions = [{ id: "s1" }, { id: "s2" }] as CalendarSession[];
    const a = { ...activity("a"), links: [{ session_id: "s1", status: "auto" as const }] };
    const b = { ...activity("b", { start_time: "2026-10-20T16:00:00.000Z" }), links: [{ session_id: "s2", status: "proposed" as const }] };
    const c = { ...activity("c"), links: [{ session_id: "s2", status: "rejected" as const }] };
    const realized: RealizedRange = {
      activities: [a, b, c],
      matches: [
        { id: "m1", session_id: "s1", activity_id: "a", status: "auto", score: 0.9, activity: a },
        { id: "m2", session_id: "s2", activity_id: "b", status: "proposed", score: 0.5, activity: b },
      ],
      completions: [completion("done")],
    };
    const [s1, s2] = withRealization(sessions, realized);
    expect(s1.realization.attached.map((x) => x.id)).toEqual(["a"]);
    expect(s1.realization.completion?.status).toBe("done");
    expect(s2.realization.proposals.map((x) => x.id)).toEqual(["b"]);
    expect(s2.realization.completion).toBeNull();
    expect(unattachedActivities(realized).map((x) => x.id)).toEqual(["c", "b"]);
  });

  it("met en forme écarts, allures et vitesses", () => {
    expect(formatSignedDuration(-300)).toBe("−5 min");
    expect(formatSignedDuration(3900)).toBe("+1 h 05");
    expect(formatSignedDuration(10)).toBe("±0 min");
    expect(formatSignedDistance(1200)).toBe("+1,2 km");
    expect(formatSignedDistance(-150, "swim")).toBe("−150 m");
    expect(formatSignedPercent(-10)).toBe("−10 %");
    expect(formatSpeed(3.333, "run")).toEqual({ label: "Allure moyenne", value: "5:00 /km" });
    expect(formatSpeed(1.25, "swim")).toEqual({ label: "Allure moyenne", value: "1:20 /100 m" });
    expect(formatSpeed(8.5, "bike")).toEqual({ label: "Vitesse moyenne", value: "30,6 km/h" });
    expect(formatSpeed(null, "bike")).toBeNull();
  });

  it("ouvre une activité depuis le calendrier, et la referme avec la séance", () => {
    const query = readCalendarQuery({ view: "week", date: "2026-10-20", activity: "0b5e8c1e-7d4b-4b9e-9c39-0d5f1a2b3c4d" }, "2026-10-20", "month");
    expect(query.activity).toBe("0b5e8c1e-7d4b-4b9e-9c39-0d5f1a2b3c4d");
    expect(calendarHref("/c", query)).toContain("activity=0b5e8c1e");
    expect(calendarHref("/c", query, { session: null })).not.toContain("activity=");
    expect(calendarHref("/c", query, { session: "1b5e8c1e-7d4b-4b9e-9c39-0d5f1a2b3c4d" })).not.toContain("activity=");
    // Une séance ouverte l'emporte sur une activité.
    expect(readCalendarQuery({ session: "1b5e8c1e-7d4b-4b9e-9c39-0d5f1a2b3c4d", activity: "0b5e8c1e-7d4b-4b9e-9c39-0d5f1a2b3c4d" }, "2026-10-20", "month").activity).toBeNull();
  });
});
