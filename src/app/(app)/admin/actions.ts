"use server";

/** Actions d'administration de l'intégration Strava (réservées aux administrateurs). */
import { refresh } from "next/cache";
import { getSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import { StravaError } from "@/lib/strava/api";
import { stravaDeps } from "@/lib/strava/deps";
import { logSync, runDueJobs } from "@/lib/strava/service";

type Result = { status: "ok"; message: string } | { status: "error"; message: string };

async function adminDeps(): Promise<{ deps: NonNullable<ReturnType<typeof stravaDeps>> } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "Votre session a expiré : reconnectez-vous." };
  const { data: isAdmin } = await session.supabase.rpc("current_user_is_admin");
  if (!isAdmin) return { error: "Réservé aux administrateurs." };
  const deps = stravaDeps();
  if (!deps) return { error: "Configuration incomplète : voir la liste ci-dessus." };
  return { deps };
}

/** Crée l'abonnement webhook de l'application ; Strava valide aussitôt l'adresse de réception. */
export async function createStravaWebhook(): Promise<Result> {
  const ctx = await adminDeps();
  if ("error" in ctx) return { status: "error", message: ctx.error };
  const { deps } = ctx;
  const callbackUrl = `${await getSiteUrl()}/api/strava/webhook`;
  try {
    const existing = await deps.api.listSubscriptions();
    const same = existing.find((s) => s.callback_url === callbackUrl);
    const subscription = same ?? (existing.length ? null : await deps.api.createSubscription(callbackUrl, deps.settings.webhookVerifyToken));
    if (!subscription) {
      return {
        status: "error",
        message: `Un abonnement existe déjà vers ${existing[0]?.callback_url ?? "une autre adresse"} : désactivez-le d’abord.`,
      };
    }
    await deps.admin
      .from("provider_state")
      .upsert({ provider: "strava", subscription_id: subscription.id, subscription_callback: callbackUrl }, { onConflict: "provider" });
    await logSync(deps.admin, { level: "info", event: "strava_webhook_subscribed" });
    refresh();
    return { status: "ok", message: "Réception des activités activée : Strava préviendra TriCoach à chaque activité." };
  } catch (error) {
    const message = error instanceof StravaError ? error.message : "Strava n’a pas accepté l’abonnement.";
    await logSync(deps.admin, { level: "error", event: "strava_webhook_subscribe_failed", message });
    return { status: "error", message: `${message} Vérifiez que le site est en ligne à ${callbackUrl}.` };
  }
}

export async function deleteStravaWebhook(): Promise<Result> {
  const ctx = await adminDeps();
  if ("error" in ctx) return { status: "error", message: ctx.error };
  const { deps } = ctx;
  try {
    for (const subscription of await deps.api.listSubscriptions()) await deps.api.deleteSubscription(subscription.id);
  } catch (error) {
    return { status: "error", message: error instanceof StravaError ? error.message : "Strava n’a pas répondu." };
  }
  await deps.admin.from("provider_state").upsert({ provider: "strava", subscription_id: null, subscription_callback: null }, { onConflict: "provider" });
  await logSync(deps.admin, { level: "info", event: "strava_webhook_unsubscribed" });
  refresh();
  return { status: "ok", message: "Réception des activités désactivée." };
}

export async function runJobsNow(): Promise<Result> {
  const ctx = await adminDeps();
  if ("error" in ctx) return { status: "error", message: ctx.error };
  const report = await runDueJobs(ctx.deps, { limit: 20, budgetMs: 40_000 });
  refresh();
  return { status: "ok", message: `${report.done} job(s) terminé(s), ${report.failed} en échec, ${report.deferred} reporté(s) pour quota.` };
}

/** Donne ou retire le rôle d'administrateur (vérifié par la base : réservé aux administrateurs). */
export async function setAdminRole(userId: string, admin: boolean): Promise<Result> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Votre session a expiré : reconnectez-vous." };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { status: "error", message: "Compte inconnu." };
  const { error } = await session.supabase.rpc("admin_set_admin", { p_user: userId, p_admin: admin });
  if (error) {
    if (error.message.includes("last_admin")) return { status: "error", message: "Il faut au moins un administrateur : donnez d’abord ce rôle à un autre compte." };
    if (error.message.includes("forbidden")) return { status: "error", message: "Réservé aux administrateurs." };
    return { status: "error", message: "Le rôle n’a pas été modifié." };
  }
  refresh();
  return { status: "ok", message: admin ? "Rôle d’administrateur donné." : "Rôle d’administrateur retiré." };
}
