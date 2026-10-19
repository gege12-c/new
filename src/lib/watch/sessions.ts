/**
 * Séances servies à l'application TriCoach de la montre Garmin : résumé compact pour l'écran de la
 * montre, puis fichier FIT de séance (le même que le téléchargement manuel, relu par le SDK FIT).
 * Pur : les données viennent de la fonction `watch_sessions` de la base, appelée avec le jeton.
 */
import { z } from "zod";
import { exportSegment } from "@/lib/export/connectors";
import { exportContext, segmentSuffix } from "@/lib/export/session";
import type { ExportResult } from "@/lib/export/types";
import { addDays, formatWeekdayShort } from "@/lib/planning/dates";
import { currentThresholds, toAthleteThresholds } from "@/lib/thresholds";
import { parseWorkout, SESSION_SPORTS, type SegmentSport, type SessionSport } from "@/lib/workout/schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const numeric = z.union([z.number(), z.string().transform(Number)]).nullable();

const WatchSessionSchema = z.object({
  id: z.uuid(),
  scheduled_date: isoDate,
  start_time: z.string().nullable(),
  sport: z.enum(SESSION_SPORTS),
  title: z.string(),
  description: z.string().nullable(),
  nutrition_notes: z.string().nullable(),
  content: z.unknown(),
  planned_duration_s: numeric,
  planned_distance_m: numeric,
  version: z.number(),
});

export const WatchDataSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unauthorized") }),
  z.object({
    status: z.literal("ok"),
    device: z.object({ id: z.uuid(), name: z.string() }),
    athlete: z.object({ id: z.uuid(), name: z.string(), timezone: z.string().nullable() }),
    today: isoDate,
    sessions: z.array(WatchSessionSchema),
    thresholds: z.array(z.object({ sport: z.string(), metric: z.string(), value: z.number(), effective_from: isoDate })),
  }),
]);

export type WatchData = Extract<z.infer<typeof WatchDataSchema>, { status: "ok" }>;
export type WatchSession = WatchData["sessions"][number];

export interface WatchPart {
  index: number;
  sport: SegmentSport;
  /** Le fichier de séance Garmin peut être produit pour cette partie. */
  ok: boolean;
  /** Pourquoi il ne peut pas l'être (affiché sur la montre). */
  reason?: string;
}

export interface WatchSessionSummary {
  id: string;
  date: string;
  /** « Aujourd'hui », « Demain », « Mer. 21 ». */
  day: string;
  title: string;
  sport: SessionSport;
  durationS: number | null;
  distanceM: number | null;
  parts: WatchPart[];
}

export interface WatchSummary {
  status: "ok";
  athlete: string;
  today: string;
  sessions: WatchSessionSummary[];
}

/** Écran de montre : titres courts, apostrophe droite (toutes les polices Garmin l'ont). */
const MAX_TITLE = 40;
const MAX_REASON = 90;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").replace(/[’‘]/g, "'").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

export function watchDayLabel(date: string, today: string): string {
  if (date === today) return "Aujourd'hui";
  if (date === addDays(today, 1)) return "Demain";
  const weekday = formatWeekdayShort(date);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${Number(date.slice(8))}`;
}

function exportPart(data: WatchData, session: WatchSession, index: number): ExportResult | { ok: false; status: 404 | 422; error: string } {
  const workout = parseWorkout(session.content);
  if (!workout.success) return { ok: false, status: 422, error: "Séance à corriger dans TriCoach." };
  const segment = workout.data.segments[index];
  if (!segment) return { ok: false, status: 404, error: "Cette partie de la séance n'existe pas." };
  const thresholds = toAthleteThresholds(currentThresholds(data.thresholds, session.scheduled_date));
  return exportSegment("garmin", segment, exportContext(session, thresholds), { suffix: segmentSuffix(workout.data, index) });
}

const blockingReason = (result: ExportResult) => {
  if (result.ok) return undefined;
  const issue = result.issues.find((i) => i.severity === "blocking");
  return clip(issue ? `${issue.where ? `${issue.where} : ` : ""}${issue.message}` : "Conversion impossible.", MAX_REASON);
};

/** Résumé pour la montre : séances d'aujourd'hui à J+6, chacune avec ses parties téléchargeables. */
export function watchSummary(data: WatchData): WatchSummary {
  return {
    status: "ok",
    athlete: clip(data.athlete.name, MAX_TITLE),
    today: data.today,
    sessions: data.sessions.map((session) => {
      const workout = parseWorkout(session.content);
      const parts: WatchPart[] = workout.success
        ? workout.data.segments.map((segment, index) => {
            const result = exportPart(data, session, index);
            return result.ok
              ? { index, sport: segment.sport, ok: true }
              : { index, sport: segment.sport, ok: false, reason: "issues" in result ? blockingReason(result) : result.error };
          })
        : [];
      return {
        id: session.id,
        date: session.scheduled_date,
        day: watchDayLabel(session.scheduled_date, data.today),
        title: clip(session.title, MAX_TITLE),
        sport: session.sport,
        durationS: session.planned_duration_s === null ? null : Math.round(session.planned_duration_s),
        distanceM: session.planned_distance_m === null ? null : Math.round(session.planned_distance_m),
        parts,
      };
    }),
  };
}

export type WatchFitResult = { ok: true; bytes: Uint8Array; fileName: string } | { ok: false; status: 404 | 422; error: string };

/** Fichier FIT d'une partie d'une séance de la fenêtre servie à la montre. */
export function watchFitFile(data: WatchData, sessionId: string, index: number): WatchFitResult {
  const session = data.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, status: 404, error: "Séance introuvable sur les 7 prochains jours." };
  const result = exportPart(data, session, index);
  if ("status" in result) return result;
  if (!result.ok) return { ok: false, status: 422, error: blockingReason(result) ?? "Conversion impossible." };
  return { ok: true, bytes: result.file.bytes, fileName: result.file.fileName };
}
