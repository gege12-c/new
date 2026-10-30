/** Lectures Suunto sous les droits de l'utilisateur (RLS) : état de la connexion, guides d'une séance. */
import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/supabase/schema";

export interface SuuntoConnectionState {
  status: "active" | "reauth_required";
  connected_at: string;
  last_sync_at: string | null;
  last_error: string | null;
}

/**
 * Connexion Suunto d'un athlète ; null sans connexion ; "schema_pending" tant que la migration n'est
 * pas déployée. L'athlète lit sa propre ligne ; un coach passe par athlete_sync_status, que la base
 * limite aux athlètes qui l'ont autorisé (sans la date de connexion).
 */
export async function getSuuntoConnection(supabase: ServerSupabase, athleteId: string): Promise<SuuntoConnectionState | null | "schema_pending"> {
  const { data, error } = await supabase
    .from("external_connections")
    .select("status, connected_at, last_sync_at, last_error")
    .eq("provider", "suunto")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error) || /provider/.test(error.message)) return "schema_pending";
    throw error;
  }
  if (data) return data as SuuntoConnectionState;
  const { data: shared, error: rpcError } = await supabase.rpc("athlete_sync_status", { p_athletes: [athleteId] });
  if (rpcError) {
    if (isMissingSchema(rpcError)) return "schema_pending";
    throw rpcError;
  }
  const row = (shared ?? []).find((r) => r.provider === "suunto");
  return row
    ? {
        status: row.status as SuuntoConnectionState["status"],
        connected_at: "",
        last_sync_at: row.last_sync_at,
        last_error: row.last_error,
      }
    : null;
}

export interface SuuntoGuideState {
  segment_index: number;
  status: "sent" | "failed" | "removed";
  session_version: number;
  sent_at: string | null;
  last_error: string | null;
  issues: {
    severity: "blocking" | "loss" | "info";
    message: string;
    where?: string;
  }[];
}

export async function getSuuntoGuides(supabase: ServerSupabase, sessionId: string): Promise<SuuntoGuideState[]> {
  const { data, error } = await supabase
    .from("suunto_guides")
    .select("segment_index, status, session_version, sent_at, last_error, issues")
    .eq("session_id", sessionId)
    .order("segment_index");
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? []).map((g) => ({
    ...g,
    status: g.status as SuuntoGuideState["status"],
    issues: (g.issues ?? []) as SuuntoGuideState["issues"],
  }));
}
