/**
 * Rattache à chaque séance ce que l’utilisateur peut voir de sa réalisation : activités associées,
 * propositions à valider, déclaration de l’athlète. Pur, partagé entre serveur et client.
 */
import type { ActivityMatch, CalendarActivity, CalendarSession, SessionCompletion, SessionRealization } from "@/lib/data/planning-types";

export interface LinkedActivity extends CalendarActivity {
  /** Liens de l’activité vers des séances (visibles de l’utilisateur). */
  links: Pick<ActivityMatch, "session_id" | "status">[];
}

export interface RealizedRange {
  /** La base n'a pas encore les tables du réalisé (migration en attente) : rien à montrer. */
  unavailable?: boolean;
  /** Activités dont la date locale tombe dans la période. */
  activities: LinkedActivity[];
  /** Associations et propositions des séances de la période (l’activité peut tomber hors période). */
  matches: (ActivityMatch & { activity: CalendarActivity })[];
  completions: SessionCompletion[];
}

export const EMPTY_REALIZED: RealizedRange = { activities: [], matches: [], completions: [] };

const byStart = (a: CalendarActivity, b: CalendarActivity) => a.start_time.localeCompare(b.start_time);

export function isAttached(link: Pick<ActivityMatch, "status">): boolean {
  return link.status === "auto" || link.status === "confirmed";
}

export function withRealization<T extends Pick<CalendarSession, "id">>(sessions: T[], realized: RealizedRange): (T & { realization: SessionRealization })[] {
  const completions = new Map(realized.completions.map((c) => [c.session_id, c]));
  const attached = new Map<string, CalendarActivity[]>();
  const proposals = new Map<string, CalendarActivity[]>();
  for (const match of realized.matches) {
    const target = isAttached(match) ? attached : match.status === "proposed" ? proposals : null;
    if (!target) continue;
    target.set(match.session_id, [...(target.get(match.session_id) ?? []), match.activity]);
  }
  return sessions.map((session) => ({
    ...session,
    realization: {
      attached: (attached.get(session.id) ?? []).sort(byStart),
      proposals: (proposals.get(session.id) ?? []).sort(byStart),
      completion: completions.get(session.id) ?? null,
    },
  }));
}

/** Activités sans séance rattachée (à montrer telles quelles dans le calendrier). */
export function unattachedActivities(realized: RealizedRange): LinkedActivity[] {
  return realized.activities.filter((a) => !a.links.some(isAttached)).sort(byStart);
}
