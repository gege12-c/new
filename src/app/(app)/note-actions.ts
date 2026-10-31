"use server";

/**
 * Notes de calendrier et jours indisponibles : validées ici (Zod), écrites sous les droits de
 * l’utilisateur ; la base vérifie qui peut poser, modifier ou retirer une note (RLS).
 */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { done, fail, firstIssue, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { daysBetween } from "@/lib/planning/dates";
import { NOTE_KINDS } from "@/lib/planning/notes";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum.`)
    .optional()
    .transform((v) => (v ? v : null));

const NoteSchema = z
  .object({
    id: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.uuid("Identifiant invalide.").optional()),
    athlete_id: z.uuid("Identifiant invalide."),
    kind: z.enum(NOTE_KINDS, "Choisissez le type de note."),
    start_date: z.iso.date("Date de début invalide."),
    end_date: z.iso.date("Date de fin invalide."),
    title: optionalText(80),
    note: optionalText(500),
  })
  .refine((v) => v.end_date >= v.start_date, { message: "La fin ne peut pas précéder le début.", path: ["end_date"] })
  .refine((v) => daysBetween(v.start_date, v.end_date) <= 366, { message: "Une note couvre un an au plus.", path: ["end_date"] });

async function sessionOrFail() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function saveCalendarNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = NoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, athlete_id, ...values } = parsed.data;
  const { supabase } = await sessionOrFail();
  if (id) {
    const { data, error } = await supabase.from("calendar_notes").update(values).eq("id", id).select("id");
    if (error) return fail(friendlyError(error));
    if (!data?.length) return fail("Cette note n’existe plus, ou seul son auteur peut la modifier.");
    refresh();
    return done("Note enregistrée.", { id });
  }
  const { data, error } = await supabase.from("calendar_notes").insert({ athlete_id, ...values }).select("id").single();
  if (error || !data) return fail(friendlyError(error, "La note n’a pas pu être posée : vérifiez que vous planifiez pour cet athlète."));
  refresh();
  return done("Note posée.", { id: data.id });
}

export async function deleteCalendarNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = z.uuid("Identifiant invalide.").safeParse(formData.get("id"));
  if (!id.success) return fail(firstIssue(id.error));
  const { supabase } = await sessionOrFail();
  const { data, error } = await supabase.from("calendar_notes").delete().eq("id", id.data).select("id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("Cette note n’existe plus, ou seul son auteur peut la retirer.");
  refresh();
  return done("Note retirée.");
}
