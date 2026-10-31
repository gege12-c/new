/**
 * Envoi des séances sur la montre : comptes reliés (intervals.icu, Suunto) dans le profil de
 * l'athlète, et état d'envoi d'une séance dans son panneau. Lu sous les droits de l'utilisateur
 * connecté (RLS) : l'athlète voit ses comptes ; ses coachs, seulement l'état d'envoi de ses séances.
 */
import type { DeviceProvider } from "@/lib/devices/jobs";
import type { CompatibilityIssue } from "@/lib/export/types";
import { INTERVALS_WINDOW_DAYS } from "@/lib/intervals/workout";
import { addDays } from "@/lib/planning/dates";
import { GUIDE_WINDOW_DAYS } from "@/lib/suunto/guide";
import { isMissingSchema } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";

export const DEVICE_WINDOW_DAYS: Record<DeviceProvider, number> = { intervals: INTERVALS_WINDOW_DAYS, suunto: GUIDE_WINDOW_DAYS };

export type DeviceLastError = "reauth_required" | "sync_failed" | "not_permitted" | "app_name_mismatch" | null;

export interface DeviceAccount {
  status: "active" | "reauth_required";
  /** Identifiant du compte chez le fournisseur (nom d'utilisateur Suunto, athlète intervals.icu). */
  account: string;
  connectedAt: string;
  lastSyncAt: string | null;
  lastError: DeviceLastError;
  /** Séances déposées, et séances refusées (raison dans la séance). */
  sent: number;
  failed: number;
}

/** Comptes de montre de l'athlète connecté ; « schema_pending » tant que la base n'est pas à jour. */
export async function getDeviceAccounts(supabase: ServerSupabase, userId: string): Promise<Record<DeviceProvider, DeviceAccount | null> | "schema_pending"> {
  const [connections, workouts] = await Promise.all([
    supabase.from("external_connections").select("provider, status, external_athlete_id, connected_at, last_sync_at, last_error").in("provider", ["intervals", "suunto"]),
    supabase.from("device_workouts").select("provider, status").eq("athlete_id", userId),
  ]);
  if (isMissingSchema(connections.error) || isMissingSchema(workouts.error)) return "schema_pending";
  if (connections.error) throw connections.error;
  if (workouts.error) throw workouts.error;
  const account = (provider: DeviceProvider): DeviceAccount | null => {
    const row = (connections.data ?? []).find((c) => c.provider === provider);
    if (!row) return null;
    const rows = (workouts.data ?? []).filter((w) => w.provider === provider);
    return {
      status: row.status as DeviceAccount["status"],
      account: row.external_athlete_id,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastError: (row.last_error as DeviceLastError) ?? null,
      sent: rows.filter((r) => r.status === "sent").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  };
  return { intervals: account("intervals"), suunto: account("suunto") };
}

export type DevicePartState =
  | { state: "sent"; sentAt: string }
  | { state: "updating" }
  | { state: "pending" }
  | { state: "failed"; error: string }
  | { state: "later"; from: string }
  | { state: "past" }
  | { state: "draft" };

export interface DeviceDelivery {
  provider: DeviceProvider;
  connection: "active" | "reauth_required";
  lastError: DeviceLastError;
  /** Une ligne par partie (un enchaînement en a plusieurs). */
  parts: { segmentIndex: number; part: DevicePartState; issues: CompatibilityIssue[] }[];
}

/**
 * Où en est l'envoi d'une séance vers la montre de son athlète, pour chaque compte relié. `today`
 * est la date locale ; `segments` le nombre de parties de la séance. null si la base n'est pas à jour.
 */
export async function getDeviceDeliveries(
  supabase: ServerSupabase,
  session: { id: string; athlete_id: string; scheduled_date: string; state: string; version: number },
  segments: number,
  today: string,
  providers: DeviceProvider[],
): Promise<DeviceDelivery[] | null> {
  const [status, workouts] = await Promise.all([
    supabase.rpc("athlete_sync_status", { p_athletes: [session.athlete_id] }),
    supabase.from("device_workouts").select("provider, segment_index, status, session_version, last_error, sent_at, issues").eq("session_id", session.id),
  ]);
  if (isMissingSchema(status.error) || isMissingSchema(workouts.error)) return null;
  if (status.error) throw status.error;
  if (workouts.error) throw workouts.error;

  return providers.flatMap((provider) => {
    const account = (status.data ?? []).find((row) => row.provider === provider);
    if (!account) return [];
    const rows = new Map((workouts.data ?? []).filter((w) => w.provider === provider).map((row) => [row.segment_index, row]));
    const window = DEVICE_WINDOW_DAYS[provider];
    const until = addDays(today, window - 1);
    const parts = Array.from({ length: segments }, (_, segmentIndex) => {
      const row = rows.get(segmentIndex);
      const issues = (Array.isArray(row?.issues) ? row.issues : []) as unknown as CompatibilityIssue[];
      let part: DevicePartState;
      if (session.state === "draft") part = { state: "draft" };
      else if (session.scheduled_date < today) part = { state: "past" };
      else if (session.scheduled_date > until) part = { state: "later", from: addDays(session.scheduled_date, -(window - 1)) };
      else if (row?.status === "failed") part = { state: "failed", error: row.last_error ?? "Envoi refusé." };
      else if (row?.status === "sent" && row.sent_at) part = (row.session_version ?? 0) >= session.version ? { state: "sent", sentAt: row.sent_at } : { state: "updating" };
      else part = { state: "pending" };
      return { segmentIndex, part, issues };
    });
    return [{ provider, connection: account.status === "active" ? "active" : "reauth_required", lastError: (account.last_error as DeviceLastError) ?? null, parts }];
  });
}
