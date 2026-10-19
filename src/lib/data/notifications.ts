/** Notifications de l'utilisateur connecté (RLS : ses seules notifications). */
import "server-only";
import { NOTIFICATION_KINDS, type NotificationItem, type NotificationKind } from "@/lib/notifications/messages";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";

/** Nombre de notifications non lues ; null si la table n'existe pas encore (migration en attente). */
export async function getUnreadCount(supabase: ServerSupabase): Promise<number | null> {
  // Requête GET (et non HEAD) : une table absente renvoie alors son code d'erreur dans la réponse.
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact" }).is("read_at", null).limit(1);
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return count ?? null;
}

export async function getNotifications(supabase: ServerSupabase, limit = 50): Promise<NotificationItem[] | null> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, athlete_id, session_id, actor_id, payload, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  const ids = [...new Set((data ?? []).flatMap((n) => [n.actor_id, n.athlete_id]).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const profiles = await supabase.from("profiles").select("id, display_name").in("id", ids);
    if (profiles.error) throw profiles.error;
    for (const p of profiles.data ?? []) names.set(p.id, p.display_name);
  }
  return (data ?? [])
    .filter((n) => (NOTIFICATION_KINDS as readonly string[]).includes(n.kind))
    .map((n) => ({
      id: n.id,
      kind: n.kind as NotificationKind,
      athlete_id: n.athlete_id,
      session_id: n.session_id,
      actor_name: n.actor_id ? (names.get(n.actor_id) ?? null) : null,
      athlete_name: n.athlete_id ? (names.get(n.athlete_id) ?? null) : null,
      payload: (n.payload ?? {}) as Record<string, unknown>,
      created_at: n.created_at,
      read_at: n.read_at,
    }));
}

/** Types coupés par l'utilisateur ; null si la table n'existe pas encore. */
export async function getDisabledKinds(supabase: ServerSupabase): Promise<NotificationKind[] | null> {
  const { data, error } = await supabase.from("notification_preferences").select("disabled_kinds").maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return ((data?.disabled_kinds ?? []) as string[]).filter((k): k is NotificationKind => (NOTIFICATION_KINDS as readonly string[]).includes(k));
}
