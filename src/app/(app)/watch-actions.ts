"use server";

/** Montre Garmin : l'athlète associe sa montre avec le code qu'elle affiche, ou la dissocie. */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { done, fail, firstIssue, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { isMissingSchema, SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";

const CodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Saisissez le code affiché par la montre.")
    .max(20, "Le code compte 8 caractères, par exemple K7QX-4PRM."),
});

export async function confirmWatchPairing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CodeSchema.safeParse({ code: formData.get("code") ?? "" });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const session = await getSession();
  if (!session) redirect("/login");
  const { data, error } = await session.supabase.rpc("confirm_watch_pairing", { p_user_code: parsed.data.code });
  if (isMissingSchema(error)) return fail(SCHEMA_PENDING_MESSAGE);
  if (error) return fail(friendlyError(error));
  refresh();
  return done(`Montre associée : ${data}. Elle affiche vos séances dans quelques secondes.`);
}

export async function revokeWatchDevice(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const session = await getSession();
  if (!session) redirect("/login");
  await session.supabase.rpc("revoke_watch_device", { p_device_id: id.data });
  refresh();
}
