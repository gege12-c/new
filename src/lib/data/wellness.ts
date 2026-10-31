/** Forme du jour, lue sous les droits de l’utilisateur (l’athlète, et ses coachs autorisés). */
import "server-only";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { WellnessEntry } from "@/lib/wellness/wellness";

const COLUMNS = "athlete_id, entry_date, sleep_hours, sleep_quality, fatigue, soreness, stress, motivation, resting_hr, hrv_ms, weight_kg, note";

type Row = WellnessEntry & { athlete_id: string };

const toEntry = (row: Record<string, unknown>): Row => ({
  ...(row as unknown as Row),
  sleep_hours: row.sleep_hours === null ? null : Number(row.sleep_hours),
  weight_kg: row.weight_kg === null ? null : Number(row.weight_kg),
});

/** Jours renseignés d’une période, du plus ancien au plus récent ; null si la base n’a pas la table. */
export async function getWellness(supabase: ServerSupabase, athleteIds: string | string[], from: string, to: string): Promise<Row[] | null> {
  const ids = Array.isArray(athleteIds) ? athleteIds : [athleteIds];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("wellness_entries")
    .select(COLUMNS)
    .in("athlete_id", ids)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: true });
  if (isMissingSchema(error)) return null;
  if (error) throw error;
  return (data ?? []).map((row) => toEntry(row as Record<string, unknown>));
}
