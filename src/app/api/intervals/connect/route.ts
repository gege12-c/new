import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { INTERVALS_OAUTH_SCOPES, intervalsBaseUrl, intervalsOAuthSettings, isIntervalsOAuthReady } from "@/lib/intervals/config";
import { authorizeUrl, cookieValue, INTERVALS_STATE_COOKIE, newOAuthRequest } from "@/lib/intervals/oauth";
import { getSiteUrl } from "@/lib/site";

/** Démarre la connexion à intervals.icu par « Autoriser » (OAuth 2.0 avec PKCE, jeton anti-CSRF). */
export async function GET() {
  const site = await getSiteUrl();
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/athlete/profile", site));
  const settings = intervalsOAuthSettings();
  if (!settings || !isIntervalsOAuthReady()) return NextResponse.redirect(new URL("/athlete/profile?intervals=not_configured#montre-auto", site));

  const request = newOAuthRequest();
  (await cookies()).set(INTERVALS_STATE_COOKIE, cookieValue(request, session.userId), {
    httpOnly: true,
    secure: site.startsWith("https://"),
    sameSite: "lax",
    path: "/api/intervals",
    maxAge: 600,
  });
  return NextResponse.redirect(
    authorizeUrl(intervalsBaseUrl(), {
      clientId: settings.clientId,
      redirectUri: `${site}/api/intervals/callback`,
      scope: INTERVALS_OAUTH_SCOPES,
      state: request.state,
      challenge: request.challenge,
    }),
  );
}
