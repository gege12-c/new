import { after, NextResponse, type NextRequest } from "next/server";
import { stravaSettings } from "@/lib/strava/config";
import { stravaDeps } from "@/lib/strava/deps";
import { WebhookEventSchema } from "@/lib/strava/schemas";
import { enqueueWebhookEvent, logSync, runDueJobs } from "@/lib/strava/service";

export const maxDuration = 60;

/** Validation de l'abonnement : Strava attend, sous 2 secondes, le défi qu'il a envoyé. */
export async function GET(request: NextRequest) {
  const settings = stravaSettings();
  const params = request.nextUrl.searchParams;
  const challenge = params.get("hub.challenge");
  if (!settings || params.get("hub.mode") !== "subscribe" || !challenge || params.get("hub.verify_token") !== settings.webhookVerifyToken) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": challenge });
}

/**
 * Évènement Strava (création, modification, suppression d'activité ; retrait d'accès).
 * Réponse immédiate après mise en file ; le traitement suit, après la réponse.
 */
export async function POST(request: NextRequest) {
  const deps = stravaDeps();
  if (!deps) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const text = await request.text();
  if (text.length > 10_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const event = WebhookEventSchema.safeParse(body);
  if (!event.success) return NextResponse.json({ error: "invalid_event" }, { status: 400 });

  try {
    const outcome = await enqueueWebhookEvent(deps, event.data);
    if (outcome === "queued") after(() => runDueJobs(deps, { limit: 5, budgetMs: 40_000 }).catch(() => undefined));
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logSync(deps.admin, { level: "error", event: "strava_webhook_failed", message: error instanceof Error ? error.message : undefined }).catch(
      () => undefined,
    );
    // Strava renverra l'évènement (trois essais au total).
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
