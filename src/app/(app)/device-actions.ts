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
import { getSession } from "@/lib/auth/dal";
import { intervalsDeps } from "@/lib/devices/deps";
import { connectIntervals, disconnectIntervals, resendIntervals, runIntervalsJobs } from "@/lib/intervals/service";
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
