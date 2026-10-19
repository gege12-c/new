"use server";

/** Notifications : marquer comme lues, régler les types reçus. Les droits sont appliqués par la base. */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { done, fail, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { NOTIFICATION_KINDS } from "@/lib/notifications/messages";

async function sessionOrFail() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { supabase } = await sessionOrFail();
  const { error } = await supabase.rpc("mark_notifications_read", {});
  if (error) throw new Error(friendlyError(error));
  refresh();
}

const KindsSchema = z.array(z.enum(NOTIFICATION_KINDS)).max(NOTIFICATION_KINDS.length);

/** Le formulaire envoie les types cochés ; on enregistre ceux qui ne le sont pas. */
export async function saveNotificationPreferences(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const enabled = KindsSchema.safeParse(formData.getAll("kind"));
  if (!enabled.success) return fail("Réglage invalide.");
  const { supabase, userId } = await sessionOrFail();
  const disabled = NOTIFICATION_KINDS.filter((kind) => !enabled.data.includes(kind));
  const { error } = await supabase.from("notification_preferences").upsert({ user_id: userId, disabled_kinds: disabled }, { onConflict: "user_id" });
  if (error) return fail(friendlyError(error, "Les réglages n’ont pas été enregistrés."));
  refresh();
  return done("Réglages des notifications enregistrés.");
}
