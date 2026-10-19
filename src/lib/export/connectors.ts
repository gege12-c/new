/**
 * Connecteurs d'export : une interface commune (contrôle de compatibilité, conversion, relecture)
 * et un connecteur par fournisseur de fichiers. Capacités et procédures : ./providers.ts.
 */
import type { Segment } from "@/lib/workout/schema";
import { buildFitWorkout, validateFitWorkout } from "./fit-workout";
import { GARMIN, ZWIFT, type ConnectorInfo } from "./providers";
import { hasBlocking, safeFileName, type CompatibilityIssue, type CompatibilityReport, type ExportContext, type ExportFormat, type ExportResult, type FileProviderId, type ValidationResult } from "./types";
import { buildZwo, validateZwo } from "./zwo";

export interface FileConnector {
  info: ConnectorInfo & { id: FileProviderId; format: ExportFormat };
  mimeType: string;
  /** Conversion d'un segment, avec le contrôle de compatibilité (ce qui sera perdu). */
  build(segment: Segment, ctx: ExportContext): { bytes: Uint8Array | null; issues: CompatibilityIssue[]; blocks: number };
  /** Relecture du fichier produit. */
  validate(bytes: Uint8Array): ValidationResult;
}

export const FILE_CONNECTORS: Record<FileProviderId, FileConnector> = {
  zwift: {
    info: ZWIFT,
    mimeType: "application/xml",
    build(segment, ctx) {
      const result = buildZwo(segment, ctx);
      return { bytes: result.xml === null ? null : new TextEncoder().encode(result.xml), issues: result.issues, blocks: result.blocks };
    },
    validate(bytes) {
      return validateZwo(new TextDecoder().decode(bytes));
    },
  },
  garmin: {
    info: GARMIN,
    mimeType: "application/vnd.ant.fit",
    build(segment, ctx) {
      const result = buildFitWorkout(segment, ctx);
      return { bytes: result.bytes, issues: result.issues, blocks: result.steps };
    },
    validate(bytes) {
      return validateFitWorkout(bytes);
    },
  },
};

export function isFileProvider(value: string | null | undefined): value is FileProviderId {
  return value === "zwift" || value === "garmin";
}

/** Export complet d'un segment : compatibilité, conversion, relecture. Jamais de faux succès. */
export function exportSegment(provider: FileProviderId, segment: Segment, ctx: ExportContext, options: { suffix?: string } = {}): ExportResult {
  const connector = FILE_CONNECTORS[provider];
  if (!connector.info.sports.includes(segment.sport)) {
    return {
      ok: false,
      issues: [{ severity: "blocking", message: `${connector.info.name} ne prend pas en charge cette discipline.` }],
    };
  }
  let built: ReturnType<FileConnector["build"]>;
  try {
    built = connector.build(segment, ctx);
  } catch (error) {
    return {
      ok: false,
      issues: [{ severity: "blocking", message: `Conversion impossible : ${error instanceof Error ? error.message : "erreur inconnue"}.` }],
    };
  }
  if (!built.bytes || hasBlocking(built.issues)) return { ok: false, issues: built.issues };
  const validation = connector.validate(built.bytes);
  if (!validation.ok) {
    return {
      ok: false,
      issues: [...built.issues, { severity: "blocking", message: `Le fichier produit n'a pas passé la relecture : ${validation.errors.slice(0, 3).join(" ; ")}.` }],
    };
  }
  return {
    ok: true,
    issues: built.issues,
    file: {
      fileName: safeFileName(ctx.title, connector.info.format, options.suffix),
      mimeType: connector.mimeType,
      bytes: built.bytes,
      format: connector.info.format,
      blocks: built.blocks,
    },
  };
}

/** Rapports de compatibilité de chaque segment exportable, par fournisseur de fichiers. */
export function compatibilityReports(segments: Segment[], ctx: ExportContext): CompatibilityReport[] {
  const reports: CompatibilityReport[] = [];
  for (const provider of ["zwift", "garmin"] as const) {
    segments.forEach((segment, segmentIndex) => {
      if (!FILE_CONNECTORS[provider].info.sports.includes(segment.sport)) return;
      const suffix = segments.length > 1 ? `${segmentIndex + 1}-${segment.sport}` : undefined;
      const result = exportSegment(provider, segment, ctx, { suffix });
      reports.push({
        provider,
        segmentIndex,
        sport: segment.sport,
        ok: result.ok,
        issues: result.issues,
        fileName: result.ok ? result.file.fileName : null,
      });
    });
  }
  return reports;
}
