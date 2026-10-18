/** Cookie du jeton anti-CSRF de la connexion Strava (valable 10 minutes, limité aux routes /api/strava). */
export const STATE_COOKIE = "tc_strava_state";

/** Le retour de Strava est-il bien celui de la demande faite par cet utilisateur ? */
export function stateMatches(stored: string | undefined, returned: string | null, userId: string): boolean {
  if (!stored || !returned) return false;
  const expected = `${returned}.${userId}`;
  if (stored.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i += 1) diff |= stored.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
