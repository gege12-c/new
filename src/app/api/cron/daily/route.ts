import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema";
import { stravaDeps } from "@/lib/strava/deps";
import { enqueueDailyJobs, runDueJobs } from "@/lib/strava/service";

export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Rappels des séances de la veille restées sans retour (date locale de chaque athlète). */
async function remindMissingFeedback(): Promise<number | "not_configured" | "schema_pending"> {
  const admin = createAdminClient();
  if (!admin) return "not_configured";
  const { data, error } = await admin.rpc("notify_missing_feedback", {});
  if (error) {
    if (isMissingSchema(error)) return "schema_pending";
    throw error;
  }
  return data ?? 0;
}

/**
 * Tâche quotidienne (Vercel Cron, avec CRON_SECRET) : rappels des séances sans retour, puis
 * relecture de secours des 7 derniers jours pour chaque athlète connecté à Strava, effacement des
 * données Strava expirées, reprise des jobs en échec.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const reminders = await remindMissingFeedback();
  const deps = stravaDeps();
  if (!deps) return NextResponse.json({ status: "ok", reminders, strava: "not_configured" });
  const connections = await enqueueDailyJobs(deps);
  const report = await runDueJobs(deps, { limit: 30, budgetMs: 45_000 });
  return NextResponse.json({ status: "ok", reminders, connections, ...report });
}
