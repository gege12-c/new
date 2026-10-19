/** Valeurs de l’éditeur de séance, partagées entre les pages (serveur) et l’éditeur (client). */
import { WorkoutSchema, type Workout } from "@/lib/workout/schema";
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

/**
 * Contenu complété par le schéma (valeurs par défaut) : une séance écrite hors de l'éditeur, par
 * l'API, peut omettre des champs facultatifs. La base de la fusion, elle, reste la valeur stockée.
 */
export function editableContent(content: SessionSnapshot["content"]): Workout {
  const parsed = WorkoutSchema.safeParse(content);
  return parsed.success ? parsed.data : content;
}

export function snapshotToValues(snapshot: SessionSnapshot): EditorValues {
  return {
    scheduled_date: snapshot.scheduled_date,
    start_time: snapshot.start_time ? snapshot.start_time.slice(0, 5) : "",
    title: snapshot.title,
    objective: snapshot.objective ?? "",
    description: snapshot.description ?? "",
    nutrition_notes: snapshot.nutrition_notes ?? "",
    content: editableContent(snapshot.content),
  };
}
