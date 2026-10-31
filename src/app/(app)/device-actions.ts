"use server";

/**
 * Séances sur la montre : liaison du compte intervals.icu (clé API vérifiée puis chiffrée côté
 * serveur), nouvel envoi, déconnexion d'intervals.icu ou de Suunto. Les clés et jetons ne quittent
 * jamais le serveur ; la base n'accepte ces écritures que de lui.
 */
import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { fail, done, firstIssue, type ActionState } from "@/lib/action-state";
import {
  alignIntervalsThresholds,
  compareIntervalsThresholds,
  connectIntervals,
  disconnectIntervals,
  resendIntervals,
  runIntervalsJobs,
  type IntervalsThresholdsResult,
} from "@/lib/intervals/service";
import type { ThresholdComparison } from "@/lib/intervals/thresholds";
import { formatThresholdValue, thresholdDef } from "@/lib/thresholds";
import { todayIn } from "@/lib/time";
import { getProfile, getSession } from "@/lib/auth/dal";
import { intervalsDeps, kickDeviceSync } from "@/lib/devices/deps";
import { getSiteUrl } from "@/lib/site";
import { suuntoDeps } from "@/lib/suunto/deps";
import { disconnectSuunto, resendSuunto, runSuuntoJobs } from "@/lib/suunto/service";

type Result = { status: "ok"; message: string } | { status: "error"; message: string };

const EXPIRED = "Votre session a expiré : reconnectez-vous.";
const NOT_READY = "L’envoi vers les montres n’est pas encore configuré sur ce site (clé de chiffrement ou clé serveur manquante).";

const KeySchema = z.object({
  key: z
    .string()
    .trim()
    .min(10, "Collez la clé API affichée dans intervals.icu (Settings, Developer Settings).")
    .max(200, "Clé trop longue : collez seulement la clé API.")
    .regex(/^[A-Za-z0-9_-]+$/, "Clé illisible : collez seulement la clé API, sans espace ni autre texte."),
});

const CONNECT_MESSAGES = {
  invalid_key: "intervals.icu refuse cette clé : vérifiez-la (Settings, Developer Settings) ou générez-en une nouvelle.",
  already_linked: "Ce compte intervals.icu est déjà relié à un autre compte TriCoach.",
  unreachable: "intervals.icu ne répond pas pour l’instant : rien n’a été enregistré. Réessayez dans quelques minutes.",
} as const;

/** Vérifie la clé chez intervals.icu, la garde chiffrée, puis dépose aussitôt les séances à venir. */
export async function connectIntervalsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = KeySchema.safeParse({ key: formData.get("key") ?? "" });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const session = await getSession();
  if (!session) return fail(EXPIRED);
  const deps = intervalsDeps();
  if (!deps) return fail(NOT_READY);
  const result = await connectIntervals(deps, session.userId, parsed.data.key);
  if (result.status !== "connected") return fail(CONNECT_MESSAGES[result.status]);
  after(() => runIntervalsJobs(deps, { limit: 3, budgetMs: 40_000 }).catch(() => undefined));
  refresh();
  return done("intervals.icu est relié : vos séances publiées des 14 prochains jours y partent maintenant.");
}

export async function disconnectIntervalsAction(): Promise<Result> {
  const session = await getSession();
  if (!session) return { status: "error", message: EXPIRED };
  const deps = intervalsDeps();
  if (!deps) return { status: "error", message: NOT_READY };
  const { removed } = await disconnectIntervals(deps, session.userId);
  refresh();
  return {
    status: "ok",
    message: removed
      ? "intervals.icu est délié : vos séances à venir déposées par TriCoach en ont été retirées, et la clé est effacée."
      : "intervals.icu est délié et la clé effacée. intervals.icu n’a pas répondu : supprimez à la main, dans son calendrier, les séances à venir déposées par TriCoach.",
  };
}

export async function disconnectSuuntoAction(): Promise<Result> {
  const session = await getSession();
  if (!session) return { status: "error", message: EXPIRED };
  const deps = suuntoDeps(await getSiteUrl());
  if (!deps) return { status: "error", message: "L’envoi direct vers Suunto n’est pas configuré sur ce site." };
  const { removed } = await disconnectSuunto(deps, session.userId);
  refresh();
  return {
    status: "ok",
    message: removed
      ? "Suunto est déconnecté : les séances envoyées par TriCoach ont été retirées de votre compte Suunto."
      : "Suunto est déconnecté. Suunto n’a pas répondu : retirez à la main, dans l’application Suunto (SuuntoPlus, Guides), les séances envoyées par TriCoach.",
  };
}

/** Renvoie tout de suite les séances à venir, y compris celles qui avaient été refusées. */
export async function sendToWatchNow(): Promise<Result> {
  const session = await getSession();
  if (!session) return { status: "error", message: EXPIRED };
  const intervals = intervalsDeps();
  const suunto = suuntoDeps(await getSiteUrl());
  const queued = [intervals ? await resendIntervals(intervals, session.userId) : false, suunto ? await resendSuunto(suunto, session.userId) : false];
  if (!queued.some(Boolean)) return { status: "error", message: "Reliez d’abord un compte (intervals.icu ou Suunto), ou reconnectez-le." };
  after(async () => {
    if (intervals && queued[0]) await runIntervalsJobs(intervals, { limit: 3, budgetMs: 20_000 }).catch(() => undefined);
    if (suunto && queued[1]) await runSuuntoJobs(suunto, { limit: 3, budgetMs: 20_000 }).catch(() => undefined);
  });
  refresh();
  return { status: "ok", message: "Envoi lancé : vos séances partent dans quelques secondes." };
}

// ---------------------------------------------------------------------------
// Seuils : TriCoach et intervals.icu côte à côte
// ---------------------------------------------------------------------------

export interface ThresholdLine {
  id: string;
  label: string;
  tricoach: string | null;
  intervals: string | null;
  same: boolean;
  /** intervals.icu n'a pas de réglage pour ce sport : rien à aligner de ce côté. */
  noSettings: boolean;
}

export type ThresholdsView = { status: "ok"; lines: ThresholdLine[]; message?: string; tone?: "success" | "warning" } | { status: "error"; message: string };

const THRESHOLDS_ERRORS = {
  not_linked: "Reliez d’abord intervals.icu (ci-dessus).",
  reauth: "intervals.icu refuse la clé enregistrée : collez votre nouvelle clé pour comparer les seuils.",
  unreachable: "intervals.icu ne répond pas pour l’instant : réessayez dans quelques minutes. Rien n’a été modifié.",
} as const;

function linesOf(rows: ThresholdComparison[]): ThresholdLine[] {
  const format = (key: string, value: number | null) => {
    if (value === null) return null;
    const [sport, metric] = key.split(".");
    const def = thresholdDef(sport, metric);
    return def ? formatThresholdValue(def, value) : String(value);
  };
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    tricoach: format(row.key, row.tricoach),
    intervals: format(row.key, row.intervals),
    same: row.same,
    noSettings: row.settingsId === null,
  }));
}

function viewOf(result: IntervalsThresholdsResult, message?: (r: Extract<IntervalsThresholdsResult, { status: "ok" }>) => Pick<ThresholdsView & { status: "ok" }, "message" | "tone">): ThresholdsView {
  if (result.status !== "ok") return { status: "error", message: THRESHOLDS_ERRORS[result.status] };
  return { status: "ok", lines: linesOf(result.rows), ...(message ? message(result) : {}) };
}

/** Lit les seuils d'intervals.icu (sans rien y changer) et les met à côté de ceux de TriCoach. */
export async function compareThresholdsAction(): Promise<ThresholdsView> {
  const session = await getSession();
  if (!session) return { status: "error", message: EXPIRED };
  const deps = intervalsDeps();
  if (!deps) return { status: "error", message: NOT_READY };
  return viewOf(await compareIntervalsThresholds(deps, session.userId));
}

/** Envoie à intervals.icu les seuils de TriCoach qui diffèrent : TriCoach fait référence. */
export async function alignThresholdsAction(): Promise<ThresholdsView> {
  const session = await getSession();
  if (!session) return { status: "error", message: EXPIRED };
  const deps = intervalsDeps();
  if (!deps) return { status: "error", message: NOT_READY };
  return viewOf(await alignIntervalsThresholds(deps, session.userId), ({ aligned = 0, failed = 0 }) =>
    failed
      ? { tone: "warning", message: `${failed} seuil${failed > 1 ? "s n’ont" : " n’a"} pas pu être modifié${failed > 1 ? "s" : ""} chez intervals.icu : réessayez, ou corrigez-le${failed > 1 ? "s" : ""} dans ses réglages.` }
      : aligned
        ? { tone: "success", message: "intervals.icu a maintenant les mêmes seuils que TriCoach." }
        : { tone: "success", message: "Rien à changer : intervals.icu avait déjà les mêmes seuils." },
  );
}

/** Reprend dans TriCoach une valeur d'intervals.icu, à la date du jour (l'historique est gardé). */
export async function importIntervalsThresholdAction(lineId: string): Promise<ThresholdsView> {
  const session = await getSession();
  if (!session) return { status: "error", message: EXPIRED };
  const deps = intervalsDeps();
  if (!deps) return { status: "error", message: NOT_READY };
  const result = await compareIntervalsThresholds(deps, session.userId);
  if (result.status !== "ok") return viewOf(result);
  const row = result.rows.find((r) => r.id === lineId);
  if (!row || row.intervals === null) return { status: "error", message: "Cette valeur n’existe plus chez intervals.icu : comparez de nouveau." };
  const [sport, metric] = row.key.split(".");
  const def = thresholdDef(sport, metric);
  if (!def || row.intervals < def.min || row.intervals > def.max) return { status: "error", message: `${row.label} : la valeur d’intervals.icu est hors des limites de TriCoach.` };

  const profile = await getProfile();
  const today = await todayIn(profile.timezone);
  const values = { value: row.intervals, notes: "Repris d’intervals.icu" };
  const match = { athlete_id: session.userId, sport, metric, effective_from: today };
  const inserted = await session.supabase.from("athlete_thresholds").insert({ ...match, ...values });
  if (inserted.error?.code === "23505") {
    const updated = await session.supabase.from("athlete_thresholds").update(values).match(match).select("id");
    if (updated.error || !updated.data?.length) return { status: "error", message: "Le seuil n’a pas pu être enregistré : réessayez." };
  } else if (inserted.error) {
    return { status: "error", message: "Le seuil n’a pas pu être enregistré : réessayez." };
  }
  await kickDeviceSync();
  refresh();
  const after = await compareIntervalsThresholds(deps, session.userId);
  return viewOf(after, () => ({ tone: "success", message: `${row.label} : la valeur d’intervals.icu est reprise dans TriCoach, à partir d’aujourd’hui.` }));
}
