/**
 * État modifiable d’une séance, tel que l’éditeur le charge et l’envoie.
 * La base de données fusionne ensuite champ par champ (voir save_planned_session).
 */
import { z } from "zod";
import { SESSION_OBJECTIVES, SESSION_SPORTS, WorkoutSchema, type Workout, type SessionSport } from "@/lib/workout/schema";
import { isISODate } from "./dates";

export const EDITABLE_FIELDS = [
  "scheduled_date",
  "start_time",
  "sport",
  "title",
  "objective",
  "description",
  "nutrition_notes",
  "content",
  "planned_duration_s",
  "planned_distance_m",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface SessionSnapshot {
  scheduled_date: string;
  start_time: string | null;
  sport: SessionSport;
  title: string;
  objective: string | null;
  description: string | null;
  nutrition_notes: string | null;
  content: Workout;
  planned_duration_s: number | null;
  planned_distance_m: number | null;
}

/** « 7:30 » ou « 07:30 » → « 07:30:00 » ; vide → null. Lève une erreur si illisible. */
export function normalizeTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match || Number(match[1]) > 23) throw new Error("Heure invalide");
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

/** Texte facultatif : vide → null, espaces de bord retirés. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max, `${max} caractères maximum`)
    .nullable()
    .transform((value) => (value && value.trim() ? value.trim() : null));

export const SessionValuesSchema = z.strictObject({
  scheduled_date: z.string().refine(isISODate, "Date invalide"),
  start_time: z
    .string()
    .nullable()
    .transform((value, ctx) => {
      try {
        return normalizeTime(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Heure invalide (HH:MM)" });
        return z.NEVER;
      }
    }),
  sport: z.enum(SESSION_SPORTS),
  title: z.string().trim().min(1, "Donnez un titre à la séance").max(120, "120 caractères maximum"),
  objective: z.enum(SESSION_OBJECTIVES).nullable(),
  description: optionalText(4000),
  nutrition_notes: optionalText(2000),
  content: WorkoutSchema,
});
export type SessionValues = z.output<typeof SessionValuesSchema>;

/** Base transmise par l’éditeur : la forme est contrôlée, les valeurs viennent de la base elle-même. */
export const SnapshotSchema = z.partialRecord(z.enum(EDITABLE_FIELDS), z.unknown());

type SessionRowLike = { [K in EditableField]: unknown };

export function snapshotOf(row: SessionRowLike): SessionSnapshot {
  return {
    scheduled_date: String(row.scheduled_date),
    start_time: row.start_time ? normalizeTime(String(row.start_time)) : null,
    sport: row.sport as SessionSport,
    title: String(row.title),
    objective: (row.objective as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    nutrition_notes: (row.nutrition_notes as string | null) ?? null,
    content: row.content as Workout,
    planned_duration_s: row.planned_duration_s === null || row.planned_duration_s === undefined ? null : Number(row.planned_duration_s),
    planned_distance_m: row.planned_distance_m === null || row.planned_distance_m === undefined ? null : Number(row.planned_distance_m),
  };
}

/** JSON stable (clés triées) pour comparer deux valeurs sans dépendre de l’ordre des clés. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function changedFields(base: Partial<SessionSnapshot>, values: Partial<SessionSnapshot>): EditableField[] {
  return EDITABLE_FIELDS.filter((field) => field in values && stableJson(base[field]) !== stableJson(values[field]));
}

export const FIELD_LABELS: Record<EditableField, string> = {
  scheduled_date: "date",
  start_time: "heure",
  sport: "discipline",
  title: "titre",
  objective: "objectif",
  description: "consignes",
  nutrition_notes: "nutrition",
  content: "contenu",
  planned_duration_s: "durée",
  planned_distance_m: "distance",
};
