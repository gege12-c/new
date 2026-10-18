/**
 * Statut d’une séance tel que l’athlète et le coach le lisent.
 * - Terminée, partielle : une activité rattachée (au-delà ou en deçà de 80 % du prévu), ou la
 *   déclaration de l’athlète, qui prime.
 * - Manquée : seulement si l’athlète l’a déclarée non faite. Sans information, une séance passée
 *   est « à rapprocher », jamais supposée manquée.
 * Les activités Strava ne sont visibles que de l’athlète : le coach voit le statut que lui
 * permettent les imports FIT et les déclarations.
 */
import { completionRatio, DONE_RATIO, realizedTotals } from "@/lib/activities/compare";
import type { CalendarSession } from "@/lib/data/planning-types";
import type { ISODate } from "./dates";

export type SessionState = "draft" | "published" | "cancelled";
export type SessionStatus = "draft" | "planned" | "done" | "partial" | "missed" | "unreconciled" | "cancelled";

type StatusInput = Pick<CalendarSession, "state" | "scheduled_date"> &
  Partial<Pick<CalendarSession, "planned_duration_s" | "planned_distance_m" | "realization">>;

export function sessionStatus(session: StatusInput, today: ISODate): SessionStatus {
  if (session.state === "cancelled") return "cancelled";
  if (session.state === "draft") return "draft";
  const realization = session.realization;
  if (realization?.completion) {
    return realization.completion.status === "done" ? "done" : realization.completion.status === "partial" ? "partial" : "missed";
  }
  if (realization?.attached.length) {
    const ratio = completionRatio(
      { planned_duration_s: session.planned_duration_s ?? null, planned_distance_m: session.planned_distance_m ?? null },
      realizedTotals(realization.attached),
    );
    return ratio === null || ratio >= DONE_RATIO ? "done" : "partial";
  }
  return session.scheduled_date < today ? "unreconciled" : "planned";
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  draft: "Brouillon",
  planned: "À faire",
  done: "Terminée",
  partial: "Partielle",
  missed: "Manquée",
  unreconciled: "À rapprocher",
  cancelled: "Annulée",
};

export const STATUS_HINTS: Record<SessionStatus, string> = {
  draft: "Invisible pour l’athlète tant qu’elle n’est pas publiée.",
  planned: "Séance prévue.",
  done: "Réalisée : activité rattachée ou déclaration de l’athlète.",
  partial: "Réalisée en partie (moins de 80 % du prévu), ou déclarée partielle.",
  missed: "Déclarée non faite par l’athlète.",
  unreconciled: "Séance passée, sans activité rattachée ni déclaration de l’athlète.",
  cancelled: "Séance annulée.",
};

/** Statuts filtrables côté athlète (les brouillons du coach ne lui sont jamais montrés). */
export const ATHLETE_STATUS_FILTERS: SessionStatus[] = ["planned", "done", "partial", "missed", "unreconciled", "cancelled"];
