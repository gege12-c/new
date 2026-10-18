import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Point d’entrée après connexion : l’espace coach pour un coach, sinon l’espace athlète. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  const { data: profile } = await supabase.from("profiles").select("is_coach").eq("id", userId).single();
  return NextResponse.redirect(new URL(profile?.is_coach ? "/coach" : "/athlete", request.url));
}
