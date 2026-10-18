import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { requireSupabaseEnv } from "./env";

/** Client Supabase côté serveur, lié aux cookies de la requête (un client par requête). */
export async function createClient() {
  // Lire les cookies d’abord : au build, le rendu s’arrête ici (contenu dynamique) au lieu d’échouer sur la configuration.
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Appelé depuis un Server Component, qui ne peut pas écrire de cookies :
          // le proxy rafraîchit la session à chaque navigation.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
