/**
 * Statut d’une séance tel que l’athlète et le coach le lisent.
 * Terminée, partielle et manquée demandent les activités réalisées (import Strava, phase 3) :
 * en attendant, une séance passée est « à rapprocher », jamais déclarée faite ou manquée.
 */
import type { ISODate } from "./dates";

export type SessionState = "draft" | "published" | "cancelled";
export type SessionStatus = "draft" | "planned" | "unreconciled" | "cancelled";

export function sessionStatus(session: { state: string; scheduled_date: string }, today: ISODate): SessionStatus {
  if (session.state === "cancelled") return "cancelled";
  if (session.state === "draft") return "draft";
  return session.scheduled_date < today ? "unreconciled" : "planned";
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  draft: "Brouillon",
  planned: "À faire",
  unreconciled: "À rapprocher",
  cancelled: "Annulée",
};

export const STATUS_HINTS: Record<SessionStatus, string> = {
  draft: "Invisible pour l’athlète tant qu’elle n’est pas publiée.",
  planned: "Séance prévue.",
  unreconciled: "Séance passée : la réalisation sera comparée au prévu une fois les activités importées de Strava.",
  cancelled: "Séance annulée.",
};

/** Statuts filtrables côté athlète (les brouillons du coach ne lui sont jamais montrés). */
export const ATHLETE_STATUS_FILTERS: SessionStatus[] = ["planned", "unreconciled", "cancelled"];
