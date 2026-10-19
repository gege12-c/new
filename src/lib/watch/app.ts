/**
 * État de publication de l'application TriCoach pour montre Garmin (Connect IQ). Tant qu'elle
 * n'est pas sur le Connect IQ Store, l'interface le dit au lieu de promettre une installation.
 */
export const WATCH_APP = {
  storeUrl: null as string | null,
  availability: "Elle est en préparation : son installation sera possible dès sa publication sur le Connect IQ Store de Garmin.",
} as const;
