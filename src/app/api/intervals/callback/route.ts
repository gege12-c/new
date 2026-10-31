import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { intervalsDeps } from "@/lib/devices/deps";
import { logSync } from "@/lib/strava/service";
import { intervalsOAuthSettings } from "@/lib/intervals/config";
import { INTERVALS_STATE_COOKIE, matchingVerifier } from "@/lib/intervals/oauth";
import { connectIntervalsOAuth, runIntervalsJobs } from "@/lib/intervals/service";
import { getSiteUrl } from "@/lib/site";

export const maxDuration = 60;

/** Retour d'intervals.icu après « Autoriser » : échange du code, jeton chiffré, premier envoi des séances. */
export async function GET(request: NextRequest) {
  const site = await getSiteUrl();
  const back = (status: string) => NextResponse.redirect(new URL(`/athlete/profile?intervals=${status}#montre-auto`, site));
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const stored = jar.get(INTERVALS_STATE_COOKIE)?.value;
  jar.set(INTERVALS_STATE_COOKIE, "", { path: "/api/intervals", maxAge: 0 });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/athlete/profile", site));
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  const verifier = matchingVerifier(stored, params.get("state"), session.userId);
  if (!code || !verifier) return back("invalid_state");

  const deps = intervalsDeps();
  const settings = intervalsOAuthSettings();
  if (!deps || !settings) return back("not_configured");
  try {
    const result = await connectIntervalsOAuth(deps, session.userId, { code, verifier, ...settings });
    if (result.status !== "connected") return back(result.status);
    after(() => runIntervalsJobs(deps, { limit: 3, budgetMs: 40_000 }).catch(() => undefined));
    return back("connected");
  } catch (error) {
    await logSync(deps.admin, {
      level: "error",
      provider: "intervals",
      event: "intervals_authorize_failed",
      message: error instanceof Error ? error.message : undefined,
      athleteId: session.userId,
    }).catch(() => undefined);
    return back("error");
  }
}
