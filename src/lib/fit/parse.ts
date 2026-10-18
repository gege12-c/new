/**
 * Lecture d'un fichier d'activité FIT (montre, compteur, Garmin Connect…) avec le SDK FIT officiel
 * de Garmin. S'exécute dans le navigateur : seul le résumé (durées, distance, moyennes) part au
 * serveur, jamais la trace GPS. Un fichier multisport donne une activité par discipline.
 */
import { Decoder, Stream, Utils, type SessionMesg } from "@garmin/fitsdk";
import { boundedInt, shortText, type ActivitySport, type ImportedActivity } from "@/lib/activities/schema";

export class FitImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitImportError";
  }
}

const TRAINER_SUB_SPORTS = new Set(["indoorCycling", "virtualActivity", "treadmill", "indoorRunning", "spin"]);
const STRENGTH_SUB_SPORTS = new Set(["strengthTraining", "cardioTraining", "hiit"]);

/** Discipline d'une session FIT ; null pour une transition (elle ne compte pas comme une activité). */
export function fitSport(sport: unknown, subSport: unknown): ActivitySport | null {
  const s = typeof sport === "string" ? sport : "";
  const sub = typeof subSport === "string" ? subSport : "";
  if (s === "transition") return null;
  if (s === "running") return "run";
  if (s === "cycling" || s === "eBiking") return "bike";
  if (s === "swimming") return "swim";
  if (s === "training") return STRENGTH_SUB_SPORTS.has(sub) ? "strength" : "other";
  if (s === "fitnessEquipment") {
    if (sub === "indoorCycling" || sub === "spin") return "bike";
    if (sub === "treadmill" || sub === "indoorRunning") return "run";
    if (sub === "strengthTraining") return "strength";
  }
  return "other";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return Utils.convertDateTimeToDate(value);
  return null;
};

const decimal = (value: unknown, min: number, max: number, digits: number): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return rounded >= min && rounded <= max ? rounded : null;
};

function deviceName(fileId: Record<string, unknown> | undefined): string | null {
  if (!fileId) return null;
  const parts = [fileId.manufacturer, fileId.productName ?? fileId.garminProduct].filter((p) => typeof p === "string" && p && p !== "development");
  return shortText(parts.join(" "), 100);
}

export async function parseFitFile(buffer: ArrayBuffer): Promise<ImportedActivity[]> {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > 30 * 1024 * 1024) throw new FitImportError("Fichier trop volumineux (30 Mo au plus).");
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) throw new FitImportError("Ce n’est pas un fichier FIT.");
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) throw new FitImportError("Fichier FIT incomplet ou endommagé.");
  const { messages, errors } = decoder.read({ mergeHeartRates: false, includeUnknownData: false });
  if (errors.length) throw new FitImportError("Fichier FIT illisible.");

  const fileId = messages.fileIdMesgs?.[0] as Record<string, unknown> | undefined;
  if (fileId?.type !== "activity") {
    throw new FitImportError("Ce fichier n’est pas une activité réalisée (c’est peut-être une séance prévue ou un parcours).");
  }
  const sessions = (messages.sessionMesgs ?? []) as SessionMesg[];
  if (!sessions.length) throw new FitImportError("Aucune activité dans ce fichier.");

  // Décalage horaire local : différence entre l'heure locale et l'heure UTC de fin d'activité.
  const activity = messages.activityMesgs?.[0];
  const end = asDate(activity?.timestamp);
  const localSeconds = typeof activity?.localTimestamp === "number" ? activity.localTimestamp : null;
  let offset = end && localSeconds !== null ? Math.round(localSeconds - Utils.convertDateToDateTime(end)) : null;
  if (offset !== null && (Math.abs(offset) > 14 * 3600 || offset % 900 !== 0)) offset = null;

  const hash = await sha256Hex(bytes);
  const device = deviceName(fileId);
  const items: ImportedActivity[] = [];
  sessions.forEach((session, index) => {
    const sport = fitSport(session.sport, session.subSport);
    const start = asDate(session.startTime);
    if (!sport || !start) return;
    items.push({
      external_id: `${hash}:${index}`,
      group_key: sessions.length > 1 ? hash : null,
      sport,
      sport_detail: shortText([session.sport, session.subSport].filter((v) => typeof v === "string" && v !== "generic").join("/"), 60),
      name: null,
      start_time: start.toISOString(),
      utc_offset_s: offset,
      elapsed_s: boundedInt(session.totalElapsedTime, 0, 172_800),
      moving_s: boundedInt(session.totalTimerTime, 0, 172_800),
      distance_m: decimal(session.totalDistance, 0, 2_000_000, 1),
      elevation_gain_m: decimal(session.totalAscent, 0, 99_999, 1),
      avg_hr: boundedInt(session.avgHeartRate, 20, 260),
      max_hr: boundedInt(session.maxHeartRate, 20, 260),
      avg_power: boundedInt(session.avgPower, 0, 3000),
      weighted_power: boundedInt(session.normalizedPower, 0, 3000),
      max_power: boundedInt(session.maxPower, 0, 4000),
      avg_cadence: boundedInt(session.avgCadence, 0, 300),
      avg_speed_mps: decimal(session.enhancedAvgSpeed ?? session.avgSpeed, 0, 999, 3),
      trainer: typeof session.subSport === "string" ? TRAINER_SUB_SPORTS.has(session.subSport) : null,
      device_name: device,
    });
  });
  if (!items.length) throw new FitImportError("Aucune activité exploitable dans ce fichier.");
  return items;
}
