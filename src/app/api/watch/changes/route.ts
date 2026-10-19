import type { NextRequest } from "next/server";
import { bearerToken, loadWatchData, UNAVAILABLE, WatchUnavailableError, watchJson } from "@/lib/watch/http";
import { watchNext, watchSummary } from "@/lib/watch/sessions";

/**
 * Vérification en tâche de fond par la montre (toutes les 30 minutes) : la prochaine séance et
 * sa version, pour proposer de la charger si la montre ne l'a pas encore.
 */
export async function GET(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) return watchJson({ status: "unauthorized" });
  try {
    const data = await loadWatchData(token);
    return watchJson(data ? { status: "ok", next: watchNext(watchSummary(data)) } : { status: "unauthorized" });
  } catch (error) {
    if (error instanceof WatchUnavailableError) return watchJson(UNAVAILABLE);
    throw error;
  }
}
