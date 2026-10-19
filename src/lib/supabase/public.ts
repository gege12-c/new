/**
 * Client Supabase « public » côté serveur : clé publique, sans session ni cookie. Il ne contourne
 * aucune règle : il n'appelle que les fonctions ouvertes aux visiteurs, qui vérifient elles-mêmes
 * leur droit (par exemple le jeton d'une montre Garmin).
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { requireSupabaseEnv } from "./env";

export type PublicClient = SupabaseClient<Database>;

export function createPublicClient(): PublicClient {
  const { url, key } = requireSupabaseEnv();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "tricoach-watch" } },
  });
}
