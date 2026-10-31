/**
 * Dernière migration du dépôt : le contrôle de production la compare à celle de la base
 * (`public.schema_version()`) pour dire si la base attend sa mise à jour. À changer avec chaque
 * nouvelle migration (un test le vérifie).
 */
export const LATEST_MIGRATION = "20261031020000";
