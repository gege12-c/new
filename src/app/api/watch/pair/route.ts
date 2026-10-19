import type { NextRequest } from "next/server";
import { z } from "zod";
import { isMissingSchema } from "@/lib/supabase/schema";
import { createPublicClient } from "@/lib/supabase/public";
import { UNAVAILABLE, watchJson } from "@/lib/watch/http";

const BodySchema = z.object({ device: z.string().trim().max(60).optional() });

/**
 * Étape 1 de l'association : la montre demande un code à afficher. L'athlète le saisit dans
 * TriCoach (Profil sportif, « Montre Garmin ») ; la montre interroge ensuite /api/watch/token.
 */
export async function POST(request: NextRequest) {
  const body = BodySchema.safeParse((await request.json().catch(() => null)) ?? {});
  const { data, error } = await createPublicClient().rpc("start_watch_pairing", { p_device_name: body.success ? body.data.device : undefined });
  if (isMissingSchema(error)) return watchJson(UNAVAILABLE);
  if (error?.message.includes("pairing_unavailable")) return watchJson({ status: "busy", message: "Trop de demandes en ce moment : réessayez dans quelques minutes." });
  if (error) throw error;
  const pairing = data?.[0];
  if (!pairing) throw new Error("start_watch_pairing : aucune ligne renvoyée");
  return watchJson({
    status: "ok",
    deviceCode: pairing.device_code,
    code: pairing.user_code,
    display: `${pairing.user_code.slice(0, 4)}-${pairing.user_code.slice(4)}`,
    expiresIn: Math.max(0, Math.round((Date.parse(pairing.expires_at) - Date.now()) / 1000)),
    interval: 5,
  });
}
