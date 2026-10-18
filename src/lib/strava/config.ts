/**
 * Configuration de l'intégration Strava, lue dans les variables d'environnement du serveur.
 * Tant qu'un élément manque, le connecteur est « non configuré » : rien n'est simulé.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { parseKey } from "@/lib/crypto/secret-box";
import type { StravaEndpoints } from "./api";

export const STRAVA_DEFAULT_API_BASE_URL = "https://www.strava.com/api/v3";
export const STRAVA_DEFAULT_OAUTH_BASE_URL = "https://www.strava.com/oauth";
/** Lecture des activités, y compris celles visibles de l'athlète seul ; rien n'est publié sur Strava. */
export const STRAVA_SCOPE = "read,activity:read_all";
/** Politique Strava §6.2 : cache de 7 jours au plus ; on efface après 6 pour garder une marge. */
export const STRAVA_CACHE_DAYS = 6;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export interface StravaSettings extends StravaEndpoints {
  /** Jeton que Strava renvoie lors de la validation du webhook, dérivé du secret de l'application. */
  webhookVerifyToken: string;
}

export function stravaSettings(): StravaSettings | null {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  if (!clientId || !/^\d+$/.test(clientId) || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    apiBaseUrl: trimSlash(process.env.STRAVA_API_BASE_URL?.trim() || STRAVA_DEFAULT_API_BASE_URL),
    oauthBaseUrl: trimSlash(process.env.STRAVA_OAUTH_BASE_URL?.trim() || STRAVA_DEFAULT_OAUTH_BASE_URL),
    webhookVerifyToken: createHmac("sha256", clientSecret).update("tricoach:strava-webhook:v1").digest("hex").slice(0, 40),
  };
}

/** Clé de chiffrement des jetons (32 octets en base64). */
export function tokenEncryptionKey(): Buffer | null {
  return parseKey(process.env.TOKEN_ENCRYPTION_KEY);
}

export type Readiness = {
  stravaApp: boolean;
  encryptionKey: "ok" | "missing" | "invalid";
  serverKey: boolean;
  cronSecret: boolean;
  apiBaseUrl: string;
};

/** État de la configuration, sans jamais exposer une valeur. */
export function integrationReadiness(): Readiness {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  return {
    stravaApp: stravaSettings() !== null,
    encryptionKey: !rawKey ? "missing" : tokenEncryptionKey() ? "ok" : "invalid",
    serverKey: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    cronSecret: (process.env.CRON_SECRET?.length ?? 0) >= 16,
    apiBaseUrl: trimSlash(process.env.STRAVA_API_BASE_URL?.trim() || STRAVA_DEFAULT_API_BASE_URL),
  };
}

export function isStravaReady(readiness: Readiness = integrationReadiness()): boolean {
  return readiness.stravaApp && readiness.encryptionKey === "ok" && readiness.serverKey;
}
