/**
 * Volumes prévus par discipline. Une séance sans durée calculable n’est pas comptée à zéro :
 * elle est signalée à part, pour que le total affiché ne mente pas.
 */
import type { SessionSport } from "@/lib/workout/schema";

export interface PlannedLike {
  sport: string;
  state: string;
  planned_duration_s: number | null;
  planned_distance_m: number | string | null;
}

export interface SportVolume {
  sport: SessionSport;
  sessions: number;
  seconds: number;
  meters: number;
  /** Séances dont la durée n’est pas connue. */
  unknownDuration: number;
}

export interface VolumeSummary {
  bySport: SportVolume[];
  totalSeconds: number;
  sessions: number;
  unknownDuration: number;
}

const ORDER: SessionSport[] = ["swim", "bike", "run", "brick", "strength", "other"];

export function plannedVolume(sessions: PlannedLike[]): VolumeSummary {
  const map = new Map<SessionSport, SportVolume>();
  for (const session of sessions) {
    if (session.state === "cancelled") continue;
    const sport = session.sport as SessionSport;
    const entry = map.get(sport) ?? { sport, sessions: 0, seconds: 0, meters: 0, unknownDuration: 0 };
    entry.sessions += 1;
    if (session.planned_duration_s === null) entry.unknownDuration += 1;
    else entry.seconds += session.planned_duration_s;
    if (session.planned_distance_m !== null) entry.meters += Number(session.planned_distance_m);
    map.set(sport, entry);
  }
  const bySport = ORDER.flatMap((sport) => (map.has(sport) ? [map.get(sport)!] : []));
  return {
    bySport,
    totalSeconds: bySport.reduce((sum, v) => sum + v.seconds, 0),
    sessions: bySport.reduce((sum, v) => sum + v.sessions, 0),
    unknownDuration: bySport.reduce((sum, v) => sum + v.unknownDuration, 0),
  };
}
