/**
 * Seuils de TriCoach et seuils d'intervals.icu, côte à côte. intervals.icu s'en sert pour ce que
 * TriCoach lui laisse calculer : cibles de FC en % du seuil ou en zones, charge d'entraînement,
 * forme. TriCoach reste la référence : un geste aligne intervals.icu sur lui, et une valeur
 * d'intervals.icu peut être reprise dans TriCoach, à la date du jour (les seuils sont historisés).
 *
 * Correspondances (réglages par sport d'intervals.icu, unités SI) : vélo (Ride) : FTP, FC seuil,
 * FC max ; course (Run) : allure seuil (m/s), FC seuil, FC max ; natation (Swim) : CSS (m/s).
 */
import type { IntervalsSportSettings, SportSettingsPatch } from "./api";

export type SyncedThresholdKey = "bike.ftp_w" | "bike.lthr_bpm" | "run.threshold_pace_s_per_km" | "run.lthr_bpm" | "swim.css_s_per_100m" | "general.max_hr_bpm";

type Activity = "Ride" | "Run" | "Swim";
type Field = keyof SportSettingsPatch;

interface Mapping {
  /** Identifiant de la ligne : type d'activité et champ d'intervals.icu. */
  id: string;
  key: SyncedThresholdKey;
  label: string;
  activity: Activity;
  field: Field;
  read: (settings: IntervalsSportSettings) => number | null;
  /** Valeur d'intervals.icu dans l'unité de TriCoach, et l'inverse. */
  toTriCoach: (value: number) => number;
  toIntervals: (value: number) => number;
  /** Écart en deçà duquel les deux valeurs sont tenues pour égales (unité de TriCoach). */
  tolerance: number;
}

const same = (v: number) => v;
const MAPPINGS: readonly Mapping[] = [
  { id: "Ride.ftp", key: "bike.ftp_w", label: "FTP", activity: "Ride", field: "ftp", read: (s) => s.ftp, toTriCoach: same, toIntervals: Math.round, tolerance: 0.5 },
  { id: "Ride.lthr", key: "bike.lthr_bpm", label: "FC au seuil, vélo", activity: "Ride", field: "lthr", read: (s) => s.lthr, toTriCoach: same, toIntervals: Math.round, tolerance: 0.5 },
  {
    id: "Run.threshold_pace",
    key: "run.threshold_pace_s_per_km",
    label: "Allure seuil",
    activity: "Run",
    field: "threshold_pace",
    read: (s) => s.thresholdPaceMps,
    toTriCoach: (mps) => Math.round(1000 / mps),
    toIntervals: (seconds) => 1000 / seconds,
    tolerance: 1,
  },
  { id: "Run.lthr", key: "run.lthr_bpm", label: "FC au seuil, course", activity: "Run", field: "lthr", read: (s) => s.lthr, toTriCoach: same, toIntervals: Math.round, tolerance: 0.5 },
  {
    id: "Swim.threshold_pace",
    key: "swim.css_s_per_100m",
    label: "CSS",
    activity: "Swim",
    field: "threshold_pace",
    read: (s) => s.thresholdPaceMps,
    toTriCoach: (mps) => Math.round(100 / mps),
    toIntervals: (seconds) => 100 / seconds,
    tolerance: 1,
  },
  { id: "Run.max_hr", key: "general.max_hr_bpm", label: "FC max, course", activity: "Run", field: "max_hr", read: (s) => s.maxHr, toTriCoach: same, toIntervals: Math.round, tolerance: 0.5 },
  { id: "Ride.max_hr", key: "general.max_hr_bpm", label: "FC max, vélo", activity: "Ride", field: "max_hr", read: (s) => s.maxHr, toTriCoach: same, toIntervals: Math.round, tolerance: 0.5 },
];

export interface ThresholdComparison {
  id: string;
  key: SyncedThresholdKey;
  label: string;
  /** Valeur en vigueur dans TriCoach (unité de TriCoach), ou null. */
  tricoach: number | null;
  /** Valeur d'intervals.icu convertie dans l'unité de TriCoach, ou null. */
  intervals: number | null;
  /** Réglage d'intervals.icu concerné ; null s'il n'en a aucun pour ce sport. */
  settingsId: string | null;
  same: boolean;
}

/** Le réglage d'intervals.icu qui couvre ce type d'activité (le premier, comme intervals.icu). */
function settingsFor(all: IntervalsSportSettings[], activity: Activity): IntervalsSportSettings | undefined {
  return all.find((s) => s.types.includes(activity));
}

export function compareThresholds(current: Partial<Record<SyncedThresholdKey, number>>, settings: IntervalsSportSettings[]): ThresholdComparison[] {
  return MAPPINGS.map((m) => {
    const target = settingsFor(settings, m.activity);
    const raw = target ? m.read(target) : null;
    const intervals = raw === null ? null : m.toTriCoach(raw);
    const tricoach = current[m.key] ?? null;
    const equal = tricoach === null || intervals === null ? tricoach === intervals : Math.abs(tricoach - intervals) < m.tolerance;
    return { id: m.id, key: m.key, label: m.label, tricoach, intervals, settingsId: target?.id ?? null, same: equal };
  }).filter((row) => row.tricoach !== null || row.intervals !== null);
}

export interface SettingsUpdate {
  settingsId: string;
  patch: SportSettingsPatch;
  /** La FC seuil ou la FC max change : intervals.icu recalcule ses zones de FC. */
  recalcHrZones: boolean;
  /** Lignes alignées par cette mise à jour. */
  rows: string[];
}

/** Ce qu'il faut envoyer à intervals.icu pour l'aligner sur TriCoach (rien si tout est égal). */
export function alignmentUpdates(rows: ThresholdComparison[]): SettingsUpdate[] {
  const updates = new Map<string, SettingsUpdate>();
  for (const row of rows) {
    if (row.same || row.tricoach === null || !row.settingsId) continue;
    const mapping = MAPPINGS.find((m) => m.id === row.id)!;
    const update = updates.get(row.settingsId) ?? { settingsId: row.settingsId, patch: {}, recalcHrZones: false, rows: [] };
    update.patch[mapping.field] = mapping.toIntervals(row.tricoach);
    update.recalcHrZones ||= mapping.field === "lthr" || mapping.field === "max_hr";
    update.rows.push(row.id);
    updates.set(row.settingsId, update);
  }
  return [...updates.values()];
}

/** Les champs envoyés ont-ils bien pris la valeur voulue ? (relecture de la réponse d'intervals.icu) */
export function appliedAsSent(update: SettingsUpdate, after: IntervalsSportSettings): boolean {
  const read: Record<Field, number | null> = { ftp: after.ftp, lthr: after.lthr, max_hr: after.maxHr, threshold_pace: after.thresholdPaceMps };
  return (Object.entries(update.patch) as [Field, number][]).every(([field, value]) => {
    const got = read[field];
    return got !== null && Math.abs(got - value) < (field === "threshold_pace" ? 0.005 : 0.5);
  });
}
