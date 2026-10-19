import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/dal";

/**
 * Fermeture de la session d'un compte qui n'existe plus (supprimé depuis un autre appareil, alors
 * que le jeton de celui-ci est encore valide). Un compte qui existe n'est jamais déconnecté ici :
 * un lien venu d'ailleurs ne peut pas faire sortir quelqu'un de sa session.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const { data, error } = await session.supabase.from("profiles").select("id").eq("id", session.userId).maybeSingle();
  if (error || data) return NextResponse.redirect(new URL("/home", request.url));
  await session.supabase.auth.signOut().catch(() => undefined);
  return NextResponse.redirect(new URL("/login?deleted=1", request.url));
}
