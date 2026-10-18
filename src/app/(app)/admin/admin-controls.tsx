"use client";

import { Copy, KeyRound, Play, RadioTower, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { createStravaWebhook, deleteStravaWebhook, runJobsNow } from "./actions";

type Outcome = { status: "ok" | "error"; message: string };

function useRunner() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<Outcome | null>(null);
  const run = (action: () => Promise<Outcome>) =>
    start(async () => {
      setMessage(await action());
    });
  return { pending, message, run };
}

export function WebhookControls({ active }: { active: boolean }) {
  const { pending, message, run } = useRunner();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(deleteStravaWebhook)}>
            <Unplug aria-hidden />
            Désactiver la réception
          </Button>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => run(createStravaWebhook)}>
            <RadioTower aria-hidden />
            {pending ? "Activation…" : "Activer la réception des activités"}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(runJobsNow)}>
          <Play aria-hidden />
          Traiter la file maintenant
        </Button>
      </div>
      {message ? <Notice tone={message.status === "ok" ? "success" : "error"}>{message.message}</Notice> : null}
    </div>
  );
}

function randomSecret(bytes: number, encoding: "base64" | "hex"): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  if (encoding === "hex") return Array.from(values, (b) => b.toString(16).padStart(2, "0")).join("");
  return btoa(String.fromCharCode(...values));
}

/**
 * Génère dans le navigateur les valeurs secrètes à saisir dans Vercel. Rien n’est envoyé au
 * serveur ni conservé : la valeur disparaît en quittant la page.
 */
export function SecretGenerator() {
  const [values, setValues] = useState<{ name: string; value: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setCopied(null);
          setValues([
            { name: "TOKEN_ENCRYPTION_KEY", value: randomSecret(32, "base64") },
            { name: "CRON_SECRET", value: randomSecret(24, "hex") },
          ]);
        }}
      >
        <KeyRound aria-hidden />
        Générer des valeurs
      </Button>
      {values.length ? (
        <ul className="space-y-2">
          {values.map((item) => (
            <li key={item.name} className="rounded-[10px] border border-line p-2.5">
              <p className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-ink-soft">
                {item.name}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(item.value);
                    setCopied(item.name);
                  }}
                >
                  <Copy aria-hidden />
                  {copied === item.name ? "Copiée" : "Copier"}
                </Button>
              </p>
              <code className="mt-1 block break-all font-mono text-[12.5px] text-ink">{item.value}</code>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[12.5px] leading-snug text-muted">
        Collez chaque valeur dans Vercel (Settings, Environment Variables, environnement Production), sans la partager ailleurs. Ne changez plus la clé de
        chiffrement ensuite : les athlètes devraient reconnecter Strava.
      </p>
    </div>
  );
}
