import type { NextRequest } from "next/server";
import { bearerToken, loadWatchData, UNAVAILABLE, WatchUnavailableError, watchJson } from "@/lib/watch/http";
import { watchSummary } from "@/lib/watch/sessions";

/** Séances publiées d'aujourd'hui à J+6, en résumé pour l'écran de la montre. */
export async function GET(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) return watchJson({ status: "unauthorized" });
  try {
    const data = await loadWatchData(token);
    return watchJson(data ? { ...watchSummary(data) } : { status: "unauthorized" });
  } catch (error) {
    if (error instanceof WatchUnavailableError) return watchJson(UNAVAILABLE);
    throw error;
  }
}
