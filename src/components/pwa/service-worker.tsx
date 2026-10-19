"use client";

import { useEffect } from "react";

/** Enregistre le service worker (page hors connexion) en production. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Pas de service worker (navigation privée, navigateur ancien) : l'application fonctionne sans.
    });
  }, []);
  return null;
}
