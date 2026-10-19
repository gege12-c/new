/** Réponses et lecture du jeton pour les routes de la montre Garmin (application Connect IQ). */
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { isMissingSchema } from "@/lib/supabase/schema";
import { createPublicClient } from "@/lib/supabase/public";
import { WatchDataSchema, type WatchData } from "./sessions";

/**
 * Réponse JSON pour la montre. Statut HTTP 200 même pour un refus : certaines montres ne
 * transmettent pas le corps d'une réponse d'erreur, le champ « status » porte donc le résultat.
 */
export const watchJson = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Jeton de montre : 64 caractères hexadécimaux, dans l'en-tête Authorization. */
export function bearerToken(request: NextRequest): string | null {
  const match = /^Bearer\s+([0-9a-f]{64})$/i.exec((request.headers.get("authorization") ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

export class WatchUnavailableError extends Error {
  constructor() {
    super("La base de données du site n'a pas encore la fonction des montres.");
    this.name = "WatchUnavailableError";
  }
}

/** Séances et seuils de l'athlète de cette montre ; null si le jeton n'est pas (ou plus) valable. */
export async function loadWatchData(token: string): Promise<WatchData | null> {
  const { data, error } = await createPublicClient().rpc("watch_sessions", { p_token: token });
  if (isMissingSchema(error)) throw new WatchUnavailableError();
  if (error) throw error;
  const parsed = WatchDataSchema.safeParse(data);
  if (!parsed.success) throw new Error(`watch_sessions : réponse inattendue (${parsed.error.issues[0]?.message ?? "?"})`);
  return parsed.data.status === "ok" ? parsed.data : null;
}

export const UNAVAILABLE = { status: "unavailable", message: "TriCoach est en cours de mise à jour : réessayez plus tard." } as const;
