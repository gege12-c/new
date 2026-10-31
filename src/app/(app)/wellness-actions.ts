"use server";

/** Forme du jour : validée ici (Zod), écrite sous les droits de l’athlète (RLS : lui seul). */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { done, fail, firstIssue, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { WellnessFormSchema } from "@/lib/wellness/wellness";

export async function saveWellness(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = WellnessFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const session = await getSession();
  if (!session) redirect("/login");
  const { entry_date, ...values } = parsed.data;
  const { data: updated, error: updateError } = await session.supabase
    .from("wellness_entries")
    .update(values)
    .eq("athlete_id", session.userId)
    .eq("entry_date", entry_date)
    .select("entry_date");
  if (updateError) return fail(friendlyError(updateError));
  if (!updated?.length) {
    const { error } = await session.supabase.from("wellness_entries").insert({ entry_date, ...values });
    if (error) return fail(friendlyError(error));
  }
  refresh();
  return done("Forme du jour enregistrée.");
}
