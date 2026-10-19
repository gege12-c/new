import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page";
import { EmptyState, Notice, SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getIsAdmin, getProfile, requireSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import { integrationReadiness, isStravaReady } from "@/lib/strava/config";
import { isMissingSchema } from "@/lib/supabase/schema";
import { cn } from "@/lib/utils";
import { AccountsPanel, type AdminAccount } from "@/components/admin/accounts-panel";
import { SecretGenerator, WebhookControls } from "./admin-controls";

export const metadata: Metadata = { title: "Administration" };

export default function AdminPage() {
  return (
    <PageContainer>
      <PageHeader title="Administration" description="Configuration des intégrations, file de synchronisation et journaux techniques. Aucune donnée sportive ici." />
      <Suspense fallback={<SectionSkeleton />}>
        <AdminContent />
      </Suspense>
    </PageContainer>
  );
}

const JOB_STATUSES = [
  { status: "pending", label: "En attente" },
  { status: "running", label: "En cours" },
  { status: "failed", label: "À réessayer" },
  { status: "dead", label: "Abandonnés" },
] as const;

const JOB_KINDS: Record<string, string> = { strava_event: "Évènement Strava", strava_sync: "Synchronisation", maintenance: "Maintenance" };

const at = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(new Date(iso));

function Check2({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex gap-3 py-2.5">
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-success text-canvas" : "bg-danger-soft text-danger")}>
        {ok ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : <X className="size-3.5" strokeWidth={3} aria-hidden />}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold">
          {label} <span className="sr-only">{ok ? "(configuré)" : "(manquant)"}</span>
        </span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
    </li>
  );
}

async function AdminContent() {
  const [{ supabase, userId }, profile, isAdmin] = await Promise.all([requireSession("/admin"), getProfile(), getIsAdmin()]);
  if (!isAdmin) {
    return (
      <EmptyState title="Réservé aux administrateurs">
        Cette page n’est accessible qu’aux comptes administrateurs, désignés directement dans la base de données.
      </EmptyState>
    );
  }
  const readiness = integrationReadiness();
  const site = await getSiteUrl();
  const [state, counts, problems, logs, connections, accounts] = await Promise.all([
    supabase.from("provider_state").select("subscription_id, subscription_callback, rate_limit, rate_observed_at, blocked_until").eq("provider", "strava").maybeSingle(),
    Promise.all(
      JOB_STATUSES.map(async ({ status }) => {
        const { count } = await supabase.from("sync_jobs").select("id", { count: "exact", head: true }).eq("status", status);
        return count ?? 0;
      }),
    ),
    supabase.from("sync_jobs").select("id, kind, status, attempts, max_attempts, run_after, last_error, updated_at").in("status", ["failed", "dead"]).order("updated_at", { ascending: false }).limit(10),
    supabase.from("sync_logs").select("id, created_at, level, provider, event, message").in("level", ["warn", "error"]).order("created_at", { ascending: false }).limit(25),
    supabase.rpc("admin_connection_counts"),
    supabase.rpc("admin_accounts"),
  ]);
  const schemaPending = isMissingSchema(state.error) || isMissingSchema(connections.error) || isMissingSchema(logs.error);
  const subscription = state.data?.subscription_id ? state.data : null;
  const rate = state.data?.rate_limit as { usage15?: number; limit15?: number; usageDay?: number; limitDay?: number; readUsage15?: number; readLimit15?: number; readUsageDay?: number; readLimitDay?: number } | null;
  const connected = (connections.data ?? []).filter((c) => c.provider === "strava").reduce((sum, c) => sum + Number(c.connections), 0);
  const reauth = (connections.data ?? []).filter((c) => c.provider === "strava" && c.status === "reauth_required").reduce((sum, c) => sum + Number(c.connections), 0);

  return (
    <div className="space-y-6">
      {schemaPending || isMissingSchema(accounts.error) ? (
        <Notice tone="warning">
          La base de données n’a pas encore les mises à jour des phases 3 à 5. Collez le fichier <code className="font-mono">supabase/production/pending.sql</code> dans
          l’éditeur SQL de Supabase puis cliquez sur « Run » : tout ce qui suit fonctionnera aussitôt.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Configuration de Strava" description="Les valeurs se saisissent dans Vercel ; cette page indique seulement si elles sont présentes.">
            <ul className="-my-2.5 divide-y divide-line">
              <Check2 ok={readiness.stravaApp} label="Application Strava" hint="STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET, depuis strava.com/settings/api." />
              <Check2
                ok={readiness.encryptionKey === "ok"}
                label="Clé de chiffrement des jetons"
                hint={readiness.encryptionKey === "invalid" ? "TOKEN_ENCRYPTION_KEY est présente mais invalide : 32 octets en base64 attendus." : "TOKEN_ENCRYPTION_KEY : générez-la ci-dessous."}
              />
              <Check2 ok={readiness.serverKey} label="Clé secrète Supabase" hint="SUPABASE_SECRET_KEY, pour la file de synchronisation (jamais utilisée dans les pages)." />
              <Check2 ok={readiness.cronSecret} label="Secret des tâches planifiées" hint="CRON_SECRET (16 caractères au moins), pour la synchronisation quotidienne." />
            </ul>
            <dl className="mt-4 space-y-2 border-t border-line pt-3 text-[13px]">
              <div>
                <dt className="font-semibold text-ink-soft">À saisir dans l’application Strava : Authorization Callback Domain</dt>
                <dd className="font-mono text-ink">{new URL(site).host}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-soft">Adresse de l’API Strava utilisée</dt>
                <dd className="font-mono text-ink">{readiness.apiBaseUrl}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Valeurs secrètes" description="Pour TOKEN_ENCRYPTION_KEY et CRON_SECRET.">
            <SecretGenerator />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Réception des activités"
            description={subscription ? `Abonnement webhook ${subscription.subscription_id} actif.` : "Aucun abonnement webhook : les activités n’arrivent que par la synchronisation quotidienne ou manuelle."}
          >
            {isStravaReady(readiness) && !schemaPending ? (
              <WebhookControls active={Boolean(subscription)} />
            ) : (
              <p className="text-[14px] text-muted">{schemaPending ? "Mettez d’abord la base de données à jour." : "Complétez d’abord la configuration ci-contre."}</p>
            )}
            {subscription?.subscription_callback ? <p className="mt-3 break-all font-mono text-[12.5px] text-muted">{subscription.subscription_callback}</p> : null}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px]">
              <div>
                <dt className="text-muted">Athlètes reliés</dt>
                <dd className="figure text-[18px]">
                  {connected}
                  {reauth ? <span className="ml-2 text-[12.5px] text-warning">dont {reauth} à reconnecter</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Quota lu (15 min, jour)</dt>
                <dd className="figure text-[14px]">
                  {rate?.limit15 ? `${rate.usage15}/${rate.limit15}, ${rate.usageDay}/${rate.limitDay}` : "pas encore lu"}
                  {rate?.readLimit15 ? <span className="block text-[12.5px] text-muted">lecture : {rate.readUsage15}/{rate.readLimit15}, {rate.readUsageDay}/{rate.readLimitDay}</span> : null}
                </dd>
              </div>
            </dl>
            {state.data?.blocked_until && new Date(state.data.blocked_until) > new Date() ? (
              <p className="mt-2 text-[13px] text-warning">Quota presque atteint : appels suspendus jusqu’au {at(state.data.blocked_until, profile.timezone)}.</p>
            ) : null}
            <p className="mt-3 text-[12.5px] leading-snug text-muted">
              Strava limite une nouvelle application à 1 athlète, puis 10 sans revue (Strava, My API Application, augmenter la capacité). Au-delà, une revue Strava est
              nécessaire.
            </p>
          </Panel>

          <Panel title="File de synchronisation">
            <dl className="grid grid-cols-4 gap-2">
              {JOB_STATUSES.map(({ status, label }, index) => (
                <div key={status}>
                  <dt className="text-[12px] text-muted">{label}</dt>
                  <dd className={cn("figure text-[20px]", status === "dead" && counts[index] ? "text-danger" : undefined)}>{counts[index]}</dd>
                </div>
              ))}
            </dl>
            {(problems.data ?? []).length ? (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {(problems.data ?? []).map((job) => (
                  <li key={job.id} className="py-2 text-[13px]">
                    <span className="font-semibold">{JOB_KINDS[job.kind] ?? job.kind}</span>{" "}
                    <span className="text-muted">
                      n° {job.id}, {job.status === "dead" ? "abandonné" : `essai ${job.attempts}/${job.max_attempts}, reprise ${at(job.run_after, profile.timezone)}`}
                    </span>
                    {job.last_error ? <span className="mt-0.5 block break-words font-mono text-[12px] text-danger">{job.last_error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel title="Journal technique" description="Avertissements et erreurs récents.">
            {(logs.data ?? []).length ? (
              <ul className="-my-2 divide-y divide-line">
                {(logs.data ?? []).map((log) => (
                  <li key={log.id} className="py-2 text-[13px]">
                    <span className={cn("font-semibold", log.level === "error" ? "text-danger" : "text-warning")}>{log.event}</span>{" "}
                    <span className="text-muted">{at(log.created_at, profile.timezone)}</span>
                    {log.message ? <span className="mt-0.5 block break-words text-ink-soft">{log.message}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">Rien à signaler.</p>
            )}
          </Panel>
        </div>
      </div>
      {accounts.data ? (
        <AccountsPanel
          accounts={accounts.data.map((a) => ({ ...a, athletes: Number(a.athletes), coaches: Number(a.coaches) }) satisfies AdminAccount)}
          currentUserId={userId}
          timeZone={profile.timezone}
        />
      ) : null}
    </div>
  );
}
