import type { NextRequest } from "next/server";
import { z } from "zod";
import { isMissingSchema } from "@/lib/supabase/schema";
import { createPublicClient } from "@/lib/supabase/public";
import { UNAVAILABLE, watchJson } from "@/lib/watch/http";

const BodySchema = z.object({ deviceCode: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * Étape 3 de l'association : la montre attend que l'athlète ait saisi le code, puis reçoit son
 * jeton, une seule fois. Statuts : pending, ready (avec le jeton), expired, claimed, unknown.
 */
export async function POST(request: NextRequest) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return watchJson({ status: "invalid" }, 400);
  const { data, error } = await createPublicClient().rpc("claim_watch_token", { p_device_code: body.data.deviceCode });
  if (isMissingSchema(error)) return watchJson(UNAVAILABLE);
  if (error) throw error;
  const result = data?.[0];
  if (!result) throw new Error("claim_watch_token : aucune ligne renvoyée");
  return watchJson(result.status === "ready" ? { status: "ready", token: result.token, athlete: result.athlete_name } : { status: result.status });
}
