/** Passage d'une séance planifiée aux exports : contexte commun au panneau et au téléchargement. */
import type { Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";
import type { ExportContext } from "./types";

export function exportContext(
  session: { title: string; description: string | null; nutrition_notes: string | null },
  thresholds: AthleteThresholds | undefined,
): ExportContext {
  const description = [session.description, session.nutrition_notes ? `Nutrition : ${session.nutrition_notes}` : null].filter(Boolean).join("\n\n");
  return { title: session.title, description: description || null, author: "TriCoach", thresholds };
}

/** Suffixe de fichier d'un segment d'enchaînement (« 2-run ») ; aucun pour une séance simple. */
export function segmentSuffix(workout: Workout, index: number): string | undefined {
  const segment = workout.segments[index];
  return workout.segments.length > 1 && segment ? `${index + 1}-${segment.sport}` : undefined;
}
