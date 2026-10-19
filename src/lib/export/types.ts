/**
 * Exports de séances prévues vers les appareils et applications. Chaque fournisseur a son
 * connecteur ; ils partagent ces types : contrôle de compatibilité (ce qui sera perdu),
 * conversion, validation du fichier produit.
 */
import type { SegmentSport, Workout } from "@/lib/workout/schema";
import type { AthleteThresholds } from "@/lib/workout/zones";

export type ProviderId = "zwift" | "garmin" | "wahoo" | "suunto";
export type FileProviderId = "zwift" | "garmin";
export type ExportFormat = "zwo" | "fit";

/**
 * Gravité d'un écart entre la séance et le fichier :
 * - blocking : l'export est impossible tel quel ;
 * - loss : une information est perdue ou approchée (dit précisément) ;
 * - info : conversion sans perte, signalée pour transparence.
 */
export type IssueSeverity = "blocking" | "loss" | "info";

export interface CompatibilityIssue {
  severity: IssueSeverity;
  message: string;
  /** Étape concernée, lisible (« Étape 3, Travail »). */
  where?: string;
}

export interface ExportContext {
  title: string;
  description?: string | null;
  author?: string | null;
  /** Seuils de l'athlète à la date de la séance, pour convertir les cibles relatives ou absolues. */
  thresholds?: AthleteThresholds;
  /** Horodatage du fichier (injectable pour des fichiers reproductibles en test). */
  now?: Date;
  /** Numéro de série du fichier FIT (unique par fichier ; injectable en test). */
  serialNumber?: number;
}

export interface ExportFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  format: ExportFormat;
  /** Nombre de blocs (Zwift) ou d'étapes (FIT) écrits. */
  blocks: number;
}

export type ExportResult =
  | { ok: true; file: ExportFile; issues: CompatibilityIssue[] }
  | { ok: false; issues: CompatibilityIssue[] };

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface SegmentChoice {
  index: number;
  sport: SegmentSport;
  title: string;
}

export function segmentChoices(workout: Workout): SegmentChoice[] {
  return workout.segments.map((segment, index) => ({ index, sport: segment.sport, title: segment.title ?? "" }));
}

/** Rapport de compatibilité d'un segment pour un fournisseur, affiché avant le téléchargement. */
export interface CompatibilityReport {
  provider: FileProviderId;
  segmentIndex: number;
  sport: SegmentSport;
  ok: boolean;
  issues: CompatibilityIssue[];
  fileName: string | null;
}

export const hasBlocking = (issues: CompatibilityIssue[]) => issues.some((i) => i.severity === "blocking");

/** Nom de fichier sûr : lettres sans accents, chiffres et tirets. */
export function safeFileName(title: string, extension: string, suffix?: string): string {
  const base =
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "seance";
  return `${base}${suffix ? `-${suffix}` : ""}.${extension}`;
}
