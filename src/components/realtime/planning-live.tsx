"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type LiveState = "connecting" | "live" | "offline";

/** Intervalle de secours quand le temps réel est indisponible : jamais présenté comme « en direct ». */
const FALLBACK_INTERVAL_MS = 30_000;

/**
 * Écoute le canal privé « athlete:<id> » (Supabase Realtime, autorisé par la RLS de realtime.messages),
 * et pour l’athlète lui-même « self:<id> », qui signale ses activités Strava ; pour un coach que
 * l’athlète autorise à voir ses activités Strava, « strava:<id> ».
 * Chaque signal relance le rendu serveur de la page : les données sont relues sous les droits
 * de l’utilisateur, le message ne transporte que des identifiants.
 */
export function PlanningLive({
  athleteId,
  self = false,
  strava = false,
  className,
}: {
  athleteId: string;
  self?: boolean;
  /** Coach autorisé par l’athlète à voir ses activités Strava. */
  strava?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const supabase = createClient();
    const channels: RealtimeChannel[] = [];
    const statuses = new Map<string, string>();
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;

    const refreshSoon = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => router.refresh(), 200);
    };
    const startFallback = () => {
      if (fallback) return;
      fallback = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, FALLBACK_INTERVAL_MS);
    };
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = null;
    };

    (async () => {
      try {
        await supabase.realtime.setAuth();
      } catch {
        // Pas de jeton : la souscription échouera et le mode de secours prendra le relais.
      }
      if (cancelled) return;
      // Ce qui vient de Strava : « self:<id> » pour l’athlète lui-même, « strava:<id> » pour ses coachs autorisés.
      const topics = [`athlete:${athleteId}`, ...(self ? [`self:${athleteId}`] : strava ? [`strava:${athleteId}`] : [])];
      for (const topic of topics) {
        const channel = supabase
          .channel(topic, { config: { private: true } })
          .on("broadcast", { event: "planning_changed" }, refreshSoon)
          .subscribe((status) => {
            if (cancelled) return;
            statuses.set(topic, status);
            const failed = (t: string) => ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(statuses.get(t) ?? "");
            const primary = topics[0];
            if (failed(primary)) {
              setState("offline");
              startFallback();
            } else if (statuses.get(primary) === "SUBSCRIBED") {
              // Canal de l'athlète en direct ; si celui des activités Strava échoue, elles sont relues toutes les 30 s.
              setState("live");
              if (topics.some(failed)) startFallback();
              else stopFallback();
            }
          });
        channels.push(channel);
      }
    })();

    // Au retour sur l’onglet (téléphone sorti de veille…), on relit les données.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce) clearTimeout(debounce);
      stopFallback();
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [athleteId, self, strava, router]);

  const label = state === "live" ? "En direct" : state === "connecting" ? "Connexion…" : "Actualisation toutes les 30 s";
  const title =
    state === "live"
      ? "Les modifications apparaissent ici en quelques secondes, sans recharger la page."
      : state === "offline"
        ? "Le temps réel est indisponible : la page se met à jour toutes les 30 secondes et à chaque retour sur l’onglet."
        : undefined;
  return (
    <span role="status" title={title} className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium text-muted", className)}>
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "live" && "bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_22%,transparent)]",
          state === "connecting" && "animate-pulse bg-line-strong",
          state === "offline" && "bg-warning",
        )}
      />
      {label}
    </span>
  );
}
