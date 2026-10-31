/**
 * Thème clair ou sombre. Par défaut, celui de l'appareil ; un choix fait dans les réglages
 * (« Clair », « Sombre ») est gardé sur cet appareil. L'attribut `data-theme` de <html> est posé
 * par un script en tête de page, avant le premier affichage (pas d'éclair de l'autre thème) ;
 * guide Next.js « Preventing flash before hydration ».
 */
export type ThemeChoice = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "tricoach-theme";
/** Évènement émis quand le choix change dans cet onglet (les autres onglets reçoivent `storage`). */
export const THEME_EVENT = "tricoach-theme";
/** Couleur de la barre du navigateur et de l'application installée, par thème. */
export const THEME_COLORS: Record<Theme, string> = { light: "#f3f5f8", dark: "#0a1220" };

/** Script en tête de page : thème choisi, sinon celui de l'appareil ; stockage indisponible → appareil. */
export const THEME_SCRIPT = `(function(){var c=null;try{c=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}var t=c==="light"||c==="dark"?c:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)})()`;

/** Choix gardé en mémoire quand le stockage du navigateur est refusé (il vaut pour cette visite). */
let unsaved: ThemeChoice | null = null;

export function readThemeChoice(): ThemeChoice {
  if (unsaved) return unsaved;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function resolveTheme(choice: ThemeChoice): Theme {
  if (choice !== "auto") return choice;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applique le thème à la page et à la barre du navigateur. */
export function applyTheme(choice: ThemeChoice) {
  const theme = resolveTheme(choice);
  document.documentElement.setAttribute("data-theme", theme);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own: Theme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[choice === "auto" ? own : theme];
  }
}

export function saveThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "auto") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
    unsaved = null;
  } catch {
    unsaved = choice;
  }
  applyTheme(choice);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: choice }));
}
