/**
 * Base de données en retard sur le code : une table ou une fonction d'une migration pas encore
 * appliquée en production. Les écrans concernés le disent au lieu d'échouer (rien n'est simulé).
 */
type ErrorLike = { code?: string | number; message?: string } | null | undefined;

const MISSING_CODES = new Set(["PGRST205", "PGRST202", "PGRST200", "42P01", "42883"]);

export function isMissingSchema(error: ErrorLike): boolean {
  if (!error) return false;
  return MISSING_CODES.has(String(error.code ?? ""));
}

export const SCHEMA_PENDING_MESSAGE = "Cette fonction sera disponible après la mise à jour de la base de données du site.";
