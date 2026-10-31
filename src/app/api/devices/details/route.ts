import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { intervalsDeps } from "@/lib/devices/deps";
import { readIntervalsDetails } from "@/lib/intervals/service";

export const maxDuration = 60;

/**
 * Temps de lecture d'un lot : la dernière lecture commencée finit avant la limite de la fonction,
 * même lente (deux appels de 20 s au plus).
 */
const BATCH_MS = 15_000;

const BodySchema = z.object({ athleteId: z.uuid().optional() }).strict();

/**
 * Rattrapage des détails des activités (courbes, puissance, intervalles) reçues d'intervals.icu :
 * un lot par appel, demandé en boucle par la page tant qu'il en reste et qu'elle est affichée. Pour
 * l'athlète lui-même ou pour un athlète de ce coach. Ne renvoie que des compteurs.
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
  const result = await readIntervalsDetails(deps, athleteId, { budgetMs: BATCH_MS });
  return Response.json(result);
}
