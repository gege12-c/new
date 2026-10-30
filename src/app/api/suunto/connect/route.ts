import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import { suuntoDeps } from "@/lib/suunto/deps";
import { SUUNTO_STATE_COOKIE } from "@/lib/suunto/oauth-state";
import { redirectUri } from "@/lib/suunto/service";

/** Démarre la connexion Suunto de l'athlète connecté (OAuth 2.0, avec un jeton anti-CSRF). */
export async function GET() {
  const site = await getSiteUrl();
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/athlete/profile", site));
  const deps = suuntoDeps(site);
  if (!deps) return NextResponse.redirect(new URL("/athlete/profile?suunto=not_configured#montre-suunto", site));

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(SUUNTO_STATE_COOKIE, `${state}.${session.userId}`, {
    httpOnly: true,
    secure: site.startsWith("https://"),
    sameSite: "lax",
    path: "/api/suunto",
    maxAge: 600,
  });
  return NextResponse.redirect(deps.api.authorizeUrl(redirectUri(site), state));
}
