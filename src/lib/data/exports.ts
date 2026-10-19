/** Historique des exports d'une séance (table workout_exports, phase 4). */
import { createHash } from "node:crypto";
import type { CompatibilityIssue, ExportFormat, FileProviderId } from "@/lib/export/types";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { TablesInsert } from "@/lib/supabase/database.types";
import type { ServerSupabase } from "@/lib/supabase/server";

export interface ExportHistoryEntry {
  id: string;
  provider: FileProviderId;
  format: ExportFormat;
  segment_index: number;
  session_version: number;
  status: "succeeded" | "failed";
  file_name: string | null;
  error: string | null;
  created_at: string;
  requested_by_name: string;
  losses: number;
}

/** Derniers exports d'une séance ; null si la table n'existe pas encore (migration en attente). */
export async function getExportHistory(supabase: ServerSupabase, sessionId: string, limit = 10): Promise<ExportHistoryEntry[] | null> {
  const { data, error } = await supabase
    .from("workout_exports")
    .select("id, provider, format, segment_index, session_version, status, file_name, error, created_at, issues, requested_by, requester:profiles!workout_exports_requested_by_fkey(display_name)")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingSchema(error)) return null;
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider as FileProviderId,
    format: row.format as ExportFormat,
    segment_index: row.segment_index,
    session_version: row.session_version,
    status: row.status as ExportHistoryEntry["status"],
    file_name: row.file_name,
    error: row.error,
    created_at: row.created_at,
    requested_by_name: (row.requester as { display_name: string } | null)?.display_name ?? (row.requested_by ? "Compte inaccessible" : "Compte supprimé"),
    losses: Array.isArray(row.issues) ? (row.issues as unknown as CompatibilityIssue[]).filter((i) => i?.severity === "loss").length : 0,
  }));
}

export type HistoryOutcome = "saved" | "unavailable" | "failed";

/** Enregistre un export (réussi ou non) sous les droits de l'utilisateur ; ne bloque jamais le fichier. */
export async function recordExport(
  supabase: ServerSupabase,
  entry: {
    sessionId: string;
    provider: FileProviderId;
    format: ExportFormat;
    segmentIndex: number;
    sessionVersion: number;
    issues: CompatibilityIssue[];
  } & ({ status: "succeeded"; fileName: string; bytes: Uint8Array } | { status: "failed"; error: string }),
): Promise<HistoryOutcome> {
  const success = entry.status === "succeeded";
  // athlete_id et requested_by sont fixés par la base (trigger).
  const row: Omit<TablesInsert<"workout_exports">, "athlete_id"> = {
    session_id: entry.sessionId,
    provider: entry.provider,
    format: entry.format,
    segment_index: entry.segmentIndex,
    session_version: entry.sessionVersion,
    status: entry.status,
    file_name: success ? entry.fileName : null,
    byte_size: success ? entry.bytes.byteLength : null,
    sha256: success ? createHash("sha256").update(entry.bytes).digest("hex") : null,
    issues: entry.issues.slice(0, 300).map((i) => ({ severity: i.severity, message: i.message, ...(i.where ? { where: i.where } : {}) })),
    error: success ? null : entry.error.slice(0, 500),
  };
  const { error } = await supabase.from("workout_exports").insert(row as TablesInsert<"workout_exports">);
  if (!error) return "saved";
  if (isMissingSchema(error)) return "unavailable";
  console.error("workout export history", error.code, error.message);
  return "failed";
}
