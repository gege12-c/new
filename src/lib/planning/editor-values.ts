/** Valeurs de l’éditeur de séance, partagées entre les pages (serveur) et l’éditeur (client). */
import type { Workout } from "@/lib/workout/schema";
import type { SessionSnapshot } from "./snapshot";

/** Valeurs éditées. Le sport se déduit du contenu ; les totaux sont recalculés par le serveur. */
export interface EditorValues {
  scheduled_date: string;
  start_time: string;
  title: string;
  objective: string;
  description: string;
  nutrition_notes: string;
  content: Workout;
}

export function snapshotToValues(snapshot: SessionSnapshot): EditorValues {
  return {
    scheduled_date: snapshot.scheduled_date,
    start_time: snapshot.start_time ? snapshot.start_time.slice(0, 5) : "",
    title: snapshot.title,
    objective: snapshot.objective ?? "",
    description: snapshot.description ?? "",
    nutrition_notes: snapshot.nutrition_notes ?? "",
    content: snapshot.content,
  };
}
