/**
 * Configuration de l'intégration Suunto, lue dans les variables d'environnement du serveur.
 * Tant qu'un élément manque, le connecteur est « non configuré » : rien n'est simulé.
 *
 * Valeurs issues de l'APIZone de Suunto (apizone.suunto.com, profil) : identifiant et secret de
 * l'application OAuth, clé d'abonnement (Ocp-Apim-Subscription-Key), et le nom exact de
 * l'application, que Suunto exige comme propriétaire (« owner ») de chaque guide.
 */
import "server-only";
import { parseKey } from "@/lib/crypto/secret-box";
import type { SuuntoEndpoints } from "./api";

export const SUUNTO_DEFAULT_API_BASE_URL = "https://cloudapi.suunto.com";
export const SUUNTO_DEFAULT_OAUTH_BASE_URL = "https://cloudapi-oauth.suunto.com/oauth";
/** Fenêtre d'envoi : les séances publiées d'aujourd'hui à J+14 sont sur la montre. */
export const SUUNTO_WINDOW_DAYS = 14;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export interface SuuntoSettings extends SuuntoEndpoints {
  /** Nom de l'application sur l'APIZone : « owner » des guides, vérifié par Suunto. */
  appName: string;
}

export function suuntoSettings(): SuuntoSettings | null {
  const clientId = process.env.SUUNTO_CLIENT_ID?.trim();
  const clientSecret = process.env.SUUNTO_CLIENT_SECRET?.trim();
  const subscriptionKey = process.env.SUUNTO_SUBSCRIPTION_KEY?.trim();
  const appName = process.env.SUUNTO_APP_NAME?.trim();
  if (!clientId || !clientSecret || !subscriptionKey || !appName) return null;
  return {
    clientId,
    clientSecret,
    subscriptionKey,
    appName,
    apiBaseUrl: trimSlash(process.env.SUUNTO_API_BASE_URL?.trim() || SUUNTO_DEFAULT_API_BASE_URL),
    oauthBaseUrl: trimSlash(process.env.SUUNTO_OAUTH_BASE_URL?.trim() || SUUNTO_DEFAULT_OAUTH_BASE_URL),
  };
}

/** Modes sportifs Suunto auxquels un guide est limité (identifiants du PDF « Activities » de l'APIZone). */
export function suuntoActivityIds(): Partial<Record<"run" | "bike" | "swim" | "strength" | "other", number[]>> {
  const out: Partial<Record<"run" | "bike" | "swim" | "strength" | "other", number[]>> = {};
  for (const part of (process.env.SUUNTO_ACTIVITIES ?? "").split(",")) {
    const [sport, ids] = part.split(":");
    const key = sport?.trim();
    if (!key || !ids || !["run", "bike", "swim", "strength", "other"].includes(key)) continue;
    const list = ids
      .split("|")
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (list.length) out[key as keyof typeof out] = list;
  }
  return out;
}

/** La configuration serveur permet-elle l'envoi vers Suunto (application, clé de chiffrement, clé secrète) ? */
export function isSuuntoReady(): boolean {
  return (
    suuntoSettings() !== null &&
    parseKey(process.env.TOKEN_ENCRYPTION_KEY) !== null &&
    Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}
