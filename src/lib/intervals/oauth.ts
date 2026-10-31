/**
 * Connexion à intervals.icu par « Autoriser » (OAuth 2.0 avec PKCE), selon la documentation
 * d'intervals.icu (« Intervals.icu OAuth support ») : page d'autorisation /oauth/authorize
 * (client_id, redirect_uri, scope, state, code_challenge), échange du code dans les 2 minutes.
 */
import { createHash, randomBytes } from "node:crypto";

/** Cookie de la demande en cours (jeton anti-CSRF et vérificateur PKCE), 10 minutes, routes /api/intervals. */
export const INTERVALS_STATE_COOKIE = "tc_intervals_oauth";

export function newOAuthRequest(): { state: string; verifier: string; challenge: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  return { state, verifier, challenge: pkceChallenge(verifier) };
}

/** BASE64URL(SHA256(vérificateur)), sans remplissage. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizeUrl(baseUrl: string, input: { clientId: string; redirectUri: string; scope: string; state: string; challenge: string }): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Valeur du cookie : jeton, vérificateur et utilisateur, pour vérifier le retour d'intervals.icu. */
export const cookieValue = (request: { state: string; verifier: string }, userId: string) => `${request.state}.${request.verifier}.${userId}`;

/** Le retour d'intervals.icu est-il celui de la demande de cet utilisateur ? Renvoie le vérificateur, sinon null. */
export function matchingVerifier(stored: string | undefined, returnedState: string | null, userId: string): string | null {
  if (!stored || !returnedState) return null;
  const [state, verifier, owner] = stored.split(".");
  if (!state || !verifier || owner !== userId || state.length !== returnedState.length) return null;
  let diff = 0;
  for (let i = 0; i < state.length; i += 1) diff |= state.charCodeAt(i) ^ returnedState.charCodeAt(i);
  return diff === 0 ? verifier : null;
}
