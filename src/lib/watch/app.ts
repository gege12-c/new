/**
 * État de publication de l'application TriCoach pour montre Garmin (Connect IQ). Tant qu'elle
 * n'est pas sur le Connect IQ Store, l'interface le dit et renvoie au guide d'installation par
 * câble au lieu de promettre une installation en un geste.
 */
export const WATCH_APP = {
  storeUrl: null as string | null,
  availability: "Elle n’est pas encore sur le Connect IQ Store de Garmin : en attendant, elle s’installe par câble USB depuis un ordinateur.",
  guideUrl: "https://github.com/gege12-c/new/blob/main/docs/GARMIN_WATCH.md",
} as const;
