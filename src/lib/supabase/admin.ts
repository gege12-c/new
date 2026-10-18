/**
 * Client Supabase « serveur » (clé secrète) : il contourne la RLS. Réservé aux traitements sans
 * utilisateur connecté (webhooks, tâches planifiées, échange OAuth) et aux écritures que la base
 * refuse volontairement aux utilisateurs (jetons, activités Strava). Jamais dans une page ou un
 * composant : une règle ESLint l'interdit.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

export type AdminClient = SupabaseClient<Database>;

export function createAdminClient(): AdminClient | null {
  const env = supabaseEnv();
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env || !key) return null;
  return createClient<Database>(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "tricoach-server" } },
  });
}
