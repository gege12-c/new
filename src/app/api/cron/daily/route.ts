import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { intervalsDeps } from "@/lib/devices/deps";
import { enqueueDailyIntervals, runIntervalsJobs } from "@/lib/intervals/service";
import { getSiteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema";
import { stravaDeps } from "@/lib/strava/deps";
import { enqueueDailyJobs, runDueJobs } from "@/lib/strava/service";
import { suuntoDeps } from "@/lib/suunto/deps";
import { enqueueDailySuunto, runSuuntoJobs } from "@/lib/suunto/service";

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

/** Relecture de secours des 7 derniers jours pour chaque athlète connecté, puis maintenance. */
async function stravaDaily() {
  const deps = stravaDeps();
  if (!deps) return "not_configured" as const;
  const connections = await enqueueDailyJobs(deps);
  return { connections, ...(await runDueJobs(deps, { limit: 30, budgetMs: 20_000 })) };
}

/** La fenêtre du relais intervals.icu avance d'un jour : la séance de J+13 part dans son calendrier. */
async function intervalsDaily() {
  const deps = intervalsDeps();
  if (!deps) return "not_configured" as const;
  const connections = await enqueueDailyIntervals(deps);
  return { connections, ...(await runIntervalsJobs(deps, { limit: 20, budgetMs: 15_000 })) };
}

/** La fenêtre des montres Suunto avance d'un jour : séance de J+6 à envoyer, séance d'hier à retirer. */
async function suuntoDaily() {
  const deps = suuntoDeps(await getSiteUrl());
  if (!deps) return "not_configured" as const;
  const connections = await enqueueDailySuunto(deps);
  return { connections, ...(await runSuuntoJobs(deps, { limit: 20, budgetMs: 15_000 })) };
}

/** Sans Strava, l'effacement des jobs terminés et des journaux anciens se fait quand même. */
async function maintenance() {
  const admin = createAdminClient();
  if (!admin) return "not_configured" as const;
  const { error } = await admin.rpc("run_maintenance");
  if (error) return isMissingSchema(error) ? ("schema_pending" as const) : ("failed" as const);
  return "done" as const;
}

/**
 * Tâche quotidienne (Vercel Cron, avec CRON_SECRET) : rappels des séances sans retour, Strava
 * (relecture de secours, effacement des données expirées, reprise des jobs en échec), puis
 * avancée d'un jour de la fenêtre d'envoi vers les montres (intervals.icu, Suunto en direct).
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const reminders = await remindMissingFeedback();
  const strava = await stravaDaily();
  const intervals = await intervalsDaily();
  const suunto = await suuntoDaily();
  const cleanup = strava === "not_configured" ? await maintenance() : "with_strava";
  return NextResponse.json({ status: "ok", reminders, strava, intervals, suunto, maintenance: cleanup });
}
