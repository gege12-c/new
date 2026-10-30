/** Cookie du jeton anti-CSRF de la connexion Suunto (valable 10 minutes, limité aux routes /api/suunto). */
export const SUUNTO_STATE_COOKIE = "tc_suunto_state";
export { stateMatches } from "@/lib/strava/oauth-state";
