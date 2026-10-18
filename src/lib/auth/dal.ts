/**
 * Couche d'accès aux données (DAL) : toute lecture de session passe par ici.
 * Chaque appel vérifie le jeton (getClaims) ; la RLS reste la garantie finale côté base.
 */
import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Session = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
};

export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { supabase, userId: sub, email };
});

/** Session obligatoire : sinon, retour à la page de connexion. */
export async function requireSession(next?: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return session;
}

export type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  is_coach: boolean;
};

export const getProfile = cache(async (): Promise<Profile> => {
  const { supabase, userId } = await requireSession();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, timezone, is_coach")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error("Profil introuvable pour ce compte.");
  return data;
});
