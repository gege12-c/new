/**
 * Volumes prévus par discipline. Une séance sans durée calculable n’est pas comptée à zéro :
 * elle est signalée à part, pour que le total affiché ne mente pas.
 */
import { activityDuration } from "@/lib/activities/compare";
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

/** Activité faite, pour le volume réalisé (les doublons sont déjà écartés à la lecture). */
export interface DoneLike {
  id: string;
  sport: string;
  source: string;
  moving_s: number | null;
  elapsed_s: number | null;
  distance_m: number | string | null;
}

export interface SportBalance {
  sport: SessionSport;
  /** Prévu : séances non annulées (secondes, mètres). */
  planned: number;
  plannedMeters: number;
  sessions: number;
  unknownDuration: number;
  /** Fait : activités reçues (montre, fichier FIT), Strava exclu. */
  done: number;
  doneMeters: number;
  activities: number;
}

export interface WeekBalance {
  bySport: SportBalance[];
  planned: number;
  done: number;
  sessions: number;
  activities: number;
  unknownDuration: number;
  /** Activités Strava de la période : affichées dans le calendrier, jamais comptées (règles de Strava). */
  stravaSkipped: number;
}

/**
 * Prévu et fait, par discipline : les séances prévues (comme `plannedVolume`) et les activités
 * reçues, rattachées à une séance ou non (une activité vue deux fois n'est comptée qu'une fois).
 */
export function weekBalance(sessions: PlannedLike[], activities: DoneLike[]): WeekBalance {
  const planned = plannedVolume(sessions);
  const map = new Map<SessionSport, SportBalance>();
  const entry = (sport: SessionSport) => {
    const existing = map.get(sport);
    if (existing) return existing;
    const created: SportBalance = { sport, planned: 0, plannedMeters: 0, sessions: 0, unknownDuration: 0, done: 0, doneMeters: 0, activities: 0 };
    map.set(sport, created);
    return created;
  };
  for (const v of planned.bySport) {
    Object.assign(entry(v.sport), { planned: v.seconds, plannedMeters: v.meters, sessions: v.sessions, unknownDuration: v.unknownDuration });
  }
  const seen = new Set<string>();
  let stravaSkipped = 0;
  for (const activity of activities) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    if (activity.source === "strava") {
      stravaSkipped += 1;
      continue;
    }
    const sport = (ORDER as string[]).includes(activity.sport) ? (activity.sport as SessionSport) : "other";
    const row = entry(sport);
    row.activities += 1;
    // En mouvement pour l'endurance, durée totale pour le renforcement et le reste.
    row.done += activityDuration(activity) ?? 0;
    if (activity.distance_m !== null) row.doneMeters += Number(activity.distance_m);
  }
  const bySport = ORDER.flatMap((sport) => (map.has(sport) ? [map.get(sport)!] : []));
  return {
    bySport,
    planned: planned.totalSeconds,
    done: bySport.reduce((sum, v) => sum + v.done, 0),
    sessions: planned.sessions,
    activities: bySport.reduce((sum, v) => sum + v.activities, 0),
    unknownDuration: planned.unknownDuration,
    stravaSkipped,
  };
}
