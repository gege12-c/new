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
 * Écoute le canal privé « athlete:<id> » (Supabase Realtime, autorisé par la RLS de realtime.messages).
 * Chaque signal relance le rendu serveur de la page : les données sont relues sous les droits
 * de l’utilisateur, le message ne transporte que des identifiants.
 */
export function PlanningLive({ athleteId, className }: { athleteId: string; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
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
      channel = supabase
        .channel(`athlete:${athleteId}`, { config: { private: true } })
        .on("broadcast", { event: "planning_changed" }, refreshSoon)
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            setState("live");
            stopFallback();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setState("offline");
            startFallback();
          }
        });
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
      if (channel) void supabase.removeChannel(channel);
    };
  }, [athleteId, router]);

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
