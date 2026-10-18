import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import { isStravaReady, STRAVA_SCOPE, stravaSettings } from "@/lib/strava/config";
import { STATE_COOKIE } from "@/lib/strava/oauth-state";

/** Démarre la connexion Strava de l'athlète connecté (OAuth 2.0, avec un jeton anti-CSRF). */
export async function GET() {
  const site = await getSiteUrl();
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/athlete/profile", site));
  const settings = stravaSettings();
  if (!settings || !isStravaReady()) return NextResponse.redirect(new URL("/athlete/profile?strava=not_configured#connexions", site));

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, `${state}.${session.userId}`, {
    httpOnly: true,
    secure: site.startsWith("https://"),
    sameSite: "lax",
    path: "/api/strava",
    maxAge: 600,
  });
  const authorize = new URL(`${settings.oauthBaseUrl}/authorize`);
  authorize.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: `${site}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPE,
    state,
  }).toString();
  return NextResponse.redirect(authorize);
}
