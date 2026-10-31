import { after } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { intervalsDeps } from "@/lib/devices/deps";
import { enqueueDeviceSync } from "@/lib/devices/jobs";
import { runIntervalsJobs } from "@/lib/intervals/service";

export const maxDuration = 30;

/** Une relecture au plus toutes les 10 minutes par athlète, quel que soit le nombre d'onglets ouverts. */
const BUCKET_MS = 10 * 60_000;

const BodySchema = z.object({ athleteId: z.uuid().optional() }).strict();

/**
 * À l'ouverture du calendrier ou de l'accueil : relit chez intervals.icu les activités faites (et
 * redépose les séances si besoin), pour l'athlète lui-même ou pour un athlète de ce coach. Le
 * résultat arrive par le temps réel ; rien n'est renvoyé au navigateur.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ status: "unauthorized" }, { status: 401 });
  const body = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ status: "invalid" }, { status: 400 });
  const athleteId = body.data.athleteId ?? session.userId;

  if (athleteId !== session.userId) {
    const { data: link } = await session.supabase
      .from("coach_athlete_links")
      .select("id")
      .eq("coach_id", session.userId)
      .eq("athlete_id", athleteId)
      .eq("status", "active")
      .maybeSingle();
    if (!link) return Response.json({ status: "not_found" }, { status: 404 });
  }

  const deps = intervalsDeps();
  if (!deps) return Response.json({ status: "not_configured" });
  const { data: connection } = await deps.admin
    .from("external_connections")
    .select("status")
    .eq("athlete_id", athleteId)
    .eq("provider", "intervals")
    .maybeSingle();
  if (connection?.status !== "active") return Response.json({ status: "not_linked" });

  await enqueueDeviceSync(deps.admin, "intervals", athleteId, `intervals:refresh:${athleteId}:${Math.floor(deps.now().getTime() / BUCKET_MS)}`);
  after(() => runIntervalsJobs(deps, { limit: 3, budgetMs: 20_000 }).catch(() => undefined));
  return Response.json({ status: "queued" });
}
