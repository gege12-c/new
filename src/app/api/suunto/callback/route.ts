import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import { jobRunner } from "@/lib/jobs/runner";
import { runDueJobs } from "@/lib/strava/service";
import { suuntoDeps } from "@/lib/suunto/deps";
import { stateMatches, SUUNTO_STATE_COOKIE } from "@/lib/suunto/oauth-state";
import { connectSuunto, logSuunto } from "@/lib/suunto/service";

export const maxDuration = 60;

/** Retour de Suunto après l'autorisation : échange du code, jetons chiffrés, envoi des séances des 14 prochains jours. */
export async function GET(request: NextRequest) {
  const site = await getSiteUrl();
  const back = (status: string) => NextResponse.redirect(new URL(`/athlete/profile?suunto=${status}#montre-suunto`, site));
  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const stored = jar.get(SUUNTO_STATE_COOKIE)?.value;
  jar.set(SUUNTO_STATE_COOKIE, "", { path: "/api/suunto", maxAge: 0 });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/athlete/profile", site));
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code || !stateMatches(stored, params.get("state"), session.userId)) return back("invalid_state");

  const deps = suuntoDeps(site);
  if (!deps) return back("not_configured");
  try {
    const result = await connectSuunto(deps, session.userId, code);
    if (result.status !== "connected") return back(result.status);
    // Les guides partent tout de suite, dans la file commune.
    const runner = jobRunner(site);
    if (runner) after(() => runDueJobs(runner, { limit: 10, budgetMs: 40_000 }).catch(() => undefined));
    return back("connected");
  } catch (error) {
    await logSuunto(deps.admin, {
      level: "error",
      event: "suunto_connect_failed",
      message: error instanceof Error ? error.message : undefined,
      athleteId: session.userId,
    }).catch(() => undefined);
    return back("error");
  }
}
