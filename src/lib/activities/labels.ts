/** Libellés des activités réalisées, partagés entre serveur et client. */
import type { ActivitySport } from "./schema";

const UNNAMED: Record<ActivitySport, string> = {
  swim: "Natation",
  bike: "Sortie à vélo",
  run: "Course à pied",
  strength: "Renforcement",
  other: "Activité",
};

/** Nom donné par l’athlète (Strava), sinon la discipline. */
export function activityTitle(activity: { name: string | null; sport: ActivitySport }): string {
  return activity.name ?? UNNAMED[activity.sport];
}
