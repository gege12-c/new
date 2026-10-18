/**
 * Fichiers FIT fictifs pour les tests (encodés avec le SDK FIT officiel) : aucune donnée réelle.
 */
import { Encoder, Profile, Utils, type ActivityMesg, type FileIdMesg, type LapMesg, type RecordMesg, type SessionMesg } from "@garmin/fitsdk";

export interface FakeSession {
  sport: string;
  subSport?: string;
  durationS: number;
  timerS?: number;
  distanceM?: number;
  avgHr?: number;
  avgPower?: number;
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
    encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: start, heartRate: session.avgHr ?? 120 } as RecordMesg);
    encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: end, heartRate: session.avgHr ?? 120 } as RecordMesg);
    encoder.onMesg(Profile.MesgNum.LAP, {
      timestamp: end,
      startTime: start,
      totalElapsedTime: session.durationS,
      totalTimerTime: session.timerS ?? session.durationS,
      totalDistance: session.distanceM ?? 0,
    } as LapMesg);
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
      numLaps: 1,
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
