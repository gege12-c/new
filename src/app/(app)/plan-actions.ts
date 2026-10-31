"use server";

/**
 * Plans d’entraînement : enregistrer des semaines d’un athlète en plan, appliquer un plan à un
 * athlète, supprimer un plan. Entrées validées ici (Zod) ; droits vérifiés par la base (RLS et
 * fonctions « security invoker »).
 */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { kickDeviceSync } from "@/lib/devices/deps";
import { friendlyError } from "@/lib/errors";
import { weekdayIndex } from "@/lib/planning/dates";

type Result<T = object> = ({ status: "ok" } & T) | { status: "error"; message: string };

const monday = z.iso.date("Date invalide.").refine((d) => weekdayIndex(d) === 0, "Un plan commence un lundi.");

async function sessionOrRedirect() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

const SaveSchema = z.object({
  athleteId: z.uuid("Athlète invalide."),
  from: monday,
  weeks: z.coerce.number().int().min(1, "Une semaine au moins.").max(26, "26 semaines au plus."),
  name: z.string().trim().min(1, "Donnez un nom au plan.").max(120, "120 caractères maximum."),
  description: z.string().trim().max(1000, "1 000 caractères maximum.").optional(),
});

export async function saveTrainingPlan(input: z.input<typeof SaveSchema>): Promise<Result<{ id: string }>> {
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Plan invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.rpc("save_training_plan", {
    p_athlete: parsed.data.athleteId,
    p_from: parsed.data.from,
    p_weeks: parsed.data.weeks,
    p_name: parsed.data.name,
    p_description: parsed.data.description || undefined,
  });
  if (error || !data) return { status: "error", message: friendlyError(error, "Le plan n’a pas pu être enregistré.") };
  refresh();
  return { status: "ok", id: data };
}

const ApplySchema = z.object({
  planId: z.uuid("Plan invalide."),
  athleteId: z.uuid("Choisissez un athlète."),
  start: monday,
  publish: z.boolean(),
});

export async function applyTrainingPlan(input: z.input<typeof ApplySchema>): Promise<Result<{ count: number }>> {
  const parsed = ApplySchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Application invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.rpc("apply_training_plan", {
    p_plan: parsed.data.planId,
    p_athlete: parsed.data.athleteId,
    p_start: parsed.data.start,
    p_publish: parsed.data.publish,
  });
  if (error) return { status: "error", message: friendlyError(error, "Le plan n’a pas pu être appliqué.") };
  if (parsed.data.publish) await kickDeviceSync();
  refresh();
  return { status: "ok", count: data ?? 0 };
}

export async function deleteTrainingPlan(planId: string): Promise<Result> {
  if (!z.uuid().safeParse(planId).success) return { status: "error", message: "Plan invalide." };
  const { supabase } = await sessionOrRedirect();
  const { data, error } = await supabase.from("training_plans").delete().eq("id", planId).select("id");
  if (error) return { status: "error", message: friendlyError(error) };
  if (!data?.length) return { status: "error", message: "Ce plan n’existe plus." };
  refresh();
  return { status: "ok" };
}
