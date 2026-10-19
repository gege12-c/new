import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/utils";

/**
 * Manifeste de l'application installable (PWA). `/home` renvoie vers l'espace coach ou athlète
 * selon le compte, ou vers la connexion.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Planification et suivi de l’entraînement triathlon, entre l’athlète et son coach.",
    lang: "fr",
    dir: "ltr",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#0e1a2b",
    theme_color: "#0e1a2b",
    categories: ["sports", "health", "fitness"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Aujourd’hui", url: "/athlete", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Calendrier", url: "/athlete/calendar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
