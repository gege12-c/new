/** Plans d’entraînement du coach (bibliothèque personnelle), lus sous ses droits. */
import "server-only";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { SessionSport } from "@/lib/workout/schema";

export interface TrainingPlanSummary {
  id: string;
  name: string;
  description: string | null;
  weeks: number;
  created_at: string;
  sessions: { day_offset: number; sport: SessionSport; title: string; planned_duration_s: number | null }[];
}

/** Plans du coach, du plus récent au plus ancien ; null si la base n’a pas encore les plans. */
export async function getTrainingPlans(supabase: ServerSupabase): Promise<TrainingPlanSummary[] | null> {
  const { data, error } = await supabase
    .from("training_plans")
    .select("id, name, description, weeks, created_at, sessions:training_plan_sessions(day_offset, sport, title, planned_duration_s)")
    .order("created_at", { ascending: false });
  if (isMissingSchema(error)) return null;
  if (error) throw error;
  return (data ?? []).map((plan) => ({
    ...plan,
    sessions: [...(plan.sessions ?? [])].sort((a, b) => a.day_offset - b.day_offset) as TrainingPlanSummary["sessions"],
  }));
}
