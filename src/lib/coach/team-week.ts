/**
 * Semaine de tous les athlètes d'un coach, jour par jour : séances (avec leur état : faite, en
 * partie, manquée, à faire, brouillon), activités faites hors programme, jours indisponibles, et
 * les totaux prévu et réalisé. Pur : les données viennent des lectures habituelles, sous la RLS.
 * Le réalisé ne compte jamais Strava (aucune statistique tirée de Strava).
 */
import { activityDuration } from "@/lib/activities/compare";
import { isAttached, type LinkedActivity } from "@/lib/activities/realization";
import type { CalendarNote } from "@/lib/planning/notes";
import { isUnavailability, noteTitle } from "@/lib/planning/notes";
import { addDays } from "@/lib/planning/dates";
import { sessionStatus, type SessionState, type SessionStatus } from "@/lib/planning/status";
import type { SessionRealization } from "@/lib/data/planning-types";

export interface TeamSession {
  id: string;
  athlete_id: string;
  scheduled_date: string;
  start_time: string | null;
  sport: string;
  title: string;
  state: string;
  planned_duration_s: number | null;
  planned_distance_m: number | null;
  realization: SessionRealization;
}

export interface TeamCell {
  date: string;
  sessions: { id: string; title: string; sport: string; draft: boolean; status: SessionStatus; durationS: number | null }[];
  /** Activités faites sans séance rattachée. */
  extra: { id: string; sport: string; durationS: number | null }[];
  /** Jour indisponible (rotation, déplacement…) : son intitulé. */
  away: string | null;
}

export interface TeamRow {
  athleteId: string;
  name: string;
  cells: TeamCell[];
  /** Séances publiées de la semaine. */
  plannedS: number;
  /** Activités faites de la semaine (montre, fichiers ; jamais Strava). */
  realizedS: number;
  drafts: number;
  missed: number;
}

export function teamWeek(input: {
  athletes: { id: string; name: string }[];
  sessions: TeamSession[];
  activities: LinkedActivity[];
  notes: CalendarNote[];
  monday: string;
  today: string;
}): TeamRow[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(input.monday, i));
  return input.athletes.map((athlete) => {
    const sessions = input.sessions.filter((s) => s.athlete_id === athlete.id);
    const activities = input.activities.filter((a) => a.athlete_id === athlete.id && a.source !== "strava");
    const notes = input.notes.filter((n) => n.athlete_id === athlete.id && isUnavailability(n));
    const cells = days.map((date): TeamCell => {
      const away = notes.find((n) => n.start_date <= date && n.end_date >= date);
      return {
        date,
        sessions: sessions
          .filter((s) => s.scheduled_date === date && s.state !== "cancelled")
          .map((s) => ({
            id: s.id,
            title: s.title,
            sport: s.sport,
            draft: s.state === "draft",
            status: sessionStatus({ ...s, state: s.state as SessionState }, input.today),
            durationS: s.planned_duration_s,
          })),
        extra: activities.filter((a) => a.local_date === date && !a.links.some(isAttached)).map((a) => ({ id: a.id, sport: a.sport, durationS: activityDuration(a) })),
        away: away ? noteTitle(away) : null,
      };
    });
    const published = sessions.filter((s) => s.state === "published");
    return {
      athleteId: athlete.id,
      name: athlete.name,
      cells,
      plannedS: published.reduce((sum, s) => sum + (s.planned_duration_s ?? 0), 0),
      realizedS: activities.reduce((sum, a) => sum + (activityDuration(a) ?? 0), 0),
      drafts: sessions.filter((s) => s.state === "draft").length,
      missed: cells.reduce((n, cell) => n + cell.sessions.filter((s) => s.status === "missed").length, 0),
    };
  });
}
