/**
 * Fichiers FIT fictifs pour les tests (encodés avec le SDK FIT officiel) : aucune donnée réelle.
 */
import { Encoder, Profile, Utils, type ActivityMesg, type FileIdMesg, type LapMesg, type RecordMesg, type SessionMesg } from "@garmin/fitsdk";

export interface FakeRecord {
  offsetS: number;
  power?: number;
  heartRate?: number;
  cadence?: number;
  /** m/s */
  speed?: number;
  altitude?: number;
  distance?: number;
}

export interface FakeLap {
  offsetS: number;
  durationS: number;
  avgPower?: number;
  avgHr?: number;
  intensity?: string;
}

export interface FakeSession {
  sport: string;
  subSport?: string;
  durationS: number;
  timerS?: number;
  distanceM?: number;
  avgHr?: number;
  avgPower?: number;
  /** Mesures seconde par seconde ; à défaut, une au départ et une à l'arrivée. */
  records?: FakeRecord[];
  /** Tours ; à défaut, un seul, toute la session. */
  laps?: FakeLap[];
}

export function buildActivityFit(options: { start: Date; utcOffsetS?: number; sessions: FakeSession[]; type?: string }): Uint8Array {
  const encoder = new Encoder();
  const fileId = {
    type: options.type ?? "activity",
    manufacturer: "development",
    product: 1,
    timeCreated: options.start,
    serialNumber: 4242,
  } as FileIdMesg;
  encoder.onMesg(Profile.MesgNum.FILE_ID, fileId);
  let cursor = options.start.getTime();
  options.sessions.forEach((session, index) => {
    const start = new Date(cursor);
    const end = new Date(cursor + session.durationS * 1000);
    if (session.records) {
      for (const r of session.records) {
        const { offsetS, ...fields } = r;
        encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: new Date(cursor + offsetS * 1000), ...fields } as RecordMesg);
      }
    } else {
      encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: start, heartRate: session.avgHr ?? 120 } as RecordMesg);
      encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: end, heartRate: session.avgHr ?? 120 } as RecordMesg);
    }
    const laps = session.laps ?? [{ offsetS: 0, durationS: session.durationS }];
    for (const lap of laps) {
      encoder.onMesg(Profile.MesgNum.LAP, {
        timestamp: new Date(cursor + (lap.offsetS + lap.durationS) * 1000),
        startTime: new Date(cursor + lap.offsetS * 1000),
        totalElapsedTime: lap.durationS,
        totalTimerTime: session.laps ? lap.durationS : (session.timerS ?? session.durationS),
        totalDistance: session.laps ? undefined : (session.distanceM ?? 0),
        avgPower: lap.avgPower,
        avgHeartRate: lap.avgHr,
        intensity: lap.intensity,
      } as LapMesg);
    }
    encoder.onMesg(Profile.MesgNum.SESSION, {
      messageIndex: index,
      timestamp: end,
      startTime: start,
      sport: session.sport,
      subSport: session.subSport ?? "generic",
      totalElapsedTime: session.durationS,
      totalTimerTime: session.timerS ?? session.durationS,
      totalDistance: session.distanceM ?? 0,
      avgHeartRate: session.avgHr,
      avgPower: session.avgPower,
      firstLapIndex: index,
      numLaps: laps.length,
    } as SessionMesg);
    cursor = end.getTime();
  });
  const end = new Date(cursor);
  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: end,
    numSessions: options.sessions.length,
    type: "manual",
    event: "activity",
    eventType: "stop",
    localTimestamp: Utils.convertDateToDateTime(end) + (options.utcOffsetS ?? 0),
  } as ActivityMesg);
  return encoder.close();
}
