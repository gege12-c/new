import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import { stravaDeps } from "@/lib/strava/deps";
import { stateMatches, STATE_COOKIE } from "@/lib/strava/oauth-state";
import { connectStrava, logSync, runDueJobs } from "@/lib/strava/service";

export const maxDuration = 60;

/** Retour de Strava après l'autorisation : échange du code, jetons chiffrés, import des 7 derniers jours. */
export async function GET(request: NextRequest) {
  const site = await getSiteUrl();
  const back = (status: string) => NextResponse.redirect(new URL(`/athlete/profile?strava=${status}#connexions`, site));
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value;
  jar.set(STATE_COOKIE, "", { path: "/api/strava", maxAge: 0 });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/athlete/profile", site));
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code || !stateMatches(stored, params.get("state"), session.userId)) return back("invalid_state");

  const deps = stravaDeps();
  if (!deps) return back("not_configured");
  try {
    const result = await connectStrava(deps, session.userId, code, params.get("scope"));
    if (result.status !== "connected") return back(result.status);
    after(() => runDueJobs(deps, { limit: 5, budgetMs: 40_000 }).catch(() => undefined));
    return back("connected");
  } catch (error) {
    await logSync(deps.admin, {
      level: "error",
      event: "strava_connect_failed",
      message: error instanceof Error ? error.message : undefined,
      athleteId: session.userId,
    }).catch(() => undefined);
    return back("error");
  }
}
