/** Variables publiques Supabase (URL du projet et clé publishable). */
export function supabaseEnv(): { url: string; key: string } | null {
  // Accès littéral : Next.js remplace ces valeurs au build pour le navigateur.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export class MissingSupabaseConfigError extends Error {
  constructor() {
    super(
      "Configuration Supabase manquante : définissez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (voir README).",
    );
    this.name = "MissingSupabaseConfigError";
  }
}

export function requireSupabaseEnv() {
  const env = supabaseEnv();
  if (!env) throw new MissingSupabaseConfigError();
  return env;
}
