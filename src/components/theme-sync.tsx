"use client";

import { useLayoutEffect } from "react";
import { applyTheme, readThemeChoice, THEME_EVENT, THEME_KEY } from "@/lib/theme";

/**
 * Garde le thème à jour après le script de tête de page : l'appareil qui passe en sombre (choix
 * « comme l'appareil »), un choix fait dans un autre onglet, et le remontage du mode strict en
 * développement, qui efface l'attribut posé par le script.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    const apply = () => applyTheme(readThemeChoice());
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) apply();
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    window.addEventListener(THEME_EVENT, apply);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener(THEME_EVENT, apply);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
