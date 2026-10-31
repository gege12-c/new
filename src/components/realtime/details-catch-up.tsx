"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Pages qui montrent les détails des activités (courbes, records) : relues quand un lot arrive. */
const SHOWS_DETAILS = [/^\/athlete(\/(calendar|stats|profile|season))?$/, /^\/coach\/athletes\/[^/]+(\/(stats|profile|season))?$/];
/** Au plus une relecture de la page toutes les 45 s pendant le rattrapage, et une à la fin. */
const REFRESH_EVERY_MS = 45_000;
/** Rien à rattraper : pas de nouvelle demande avant 10 minutes dans cet onglet. */
const QUIET_MS = 10 * 60_000;

type DetailsResponse =
  | { status: "ok"; read: number; remaining: number; total: number; paused: boolean }
  | { status: "busy" | "not_linked" | "reauth" | "not_configured" | "not_found" | "unauthorized" | "invalid" };

/**
 * Lit, lot après lot, les détails des activités reçues d'intervals.icu qui n'en ont pas encore
 * (courbes, puissance, intervalles) : tant que la page est affichée et qu'il en reste. Pour
 * l'athlète lui-même (sans `athleteId`) ou pour un athlète suivi par ce coach.
 */
export function useDetailsCatchUp(athleteId?: string, enabled = true) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const key = `tc:details:${athleteId ?? "self"}`;
    try {
      if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < QUIET_MS) return;
    } catch {
      // Stockage indisponible : une demande par affichage, le serveur ne lit que ce qui manque.
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRefresh = Date.now();
    let readSinceRefresh = 0;
    const quiet = () => {
      try {
        sessionStorage.setItem(key, String(Date.now()));
      } catch {
        // Voir plus haut.
      }
    };
    const refreshPage = (force: boolean) => {
      if (!readSinceRefresh || !SHOWS_DETAILS.some((re) => re.test(window.location.pathname))) return;
      if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
      lastRefresh = Date.now();
      readSinceRefresh = 0;
      router.refresh();
    };
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(ask, delay);
    };
    async function ask() {
      // Page cachée (onglet en arrière-plan, téléphone en veille) : on attend qu'elle revienne.
      if (document.visibilityState !== "visible") return schedule(15_000);
      let body: DetailsResponse;
      try {
        const response = await fetch("/api/devices/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(athleteId ? { athleteId } : {}),
        });
        body = (await response.json()) as DetailsResponse;
      } catch {
        return schedule(60_000);
      }
      if (cancelled) return;
      if (body.status === "busy") return schedule(20_000);
      if (body.status !== "ok") return quiet();
      readSinceRefresh += body.read;
      if (body.remaining > 0) {
        refreshPage(false);
        // Quota ou panne passagère chez intervals.icu : on laisse passer une minute.
        return schedule(body.paused ? 60_000 : 1_000);
      }
      refreshPage(true);
      quiet();
    }
    // Après la relecture faite à l'ouverture de la page, qui passe la première.
    schedule(4_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [athleteId, enabled, router]);
}

/** Rattrapage des détails pour l'athlète connecté, sur toutes les pages de l'espace connecté. */
export function DetailsCatchUp() {
  useDetailsCatchUp();
  return null;
}
