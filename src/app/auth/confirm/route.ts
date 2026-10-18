import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/**
 * Retour du lien de confirmation d’email.
 * Gère les deux formes de lien Supabase : `?code=` (PKCE, par défaut) et `?token_hash=&type=` (modèle d’email personnalisé).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    // Lien ouvert sur un autre appareil : l’adresse est confirmée, mais la session n’a pas pu être ouverte ici.
    const login = new URL("/login", request.url);
    login.searchParams.set("confirmed", "1");
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("error", searchParams.get("error_description") ?? "Lien de confirmation invalide ou expiré.");
  return NextResponse.redirect(login);
}
