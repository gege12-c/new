import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { recordExport } from "@/lib/data/exports";
import { getSessionDetail, getThresholdsOn } from "@/lib/data/planning";
import { exportSegment, FILE_CONNECTORS } from "@/lib/export/connectors";
import { exportContext, segmentSuffix } from "@/lib/export/session";
import { parseWorkout } from "@/lib/workout/schema";

const ParamsSchema = z.object({ sessionId: z.uuid() });
const QuerySchema = z.object({
  provider: z.enum(["zwift", "garmin"]),
  segment: z.coerce.number().int().min(0).max(5).default(0),
});

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Téléchargement d'une séance prévue au format d'un fournisseur (.zwo pour Zwift, FIT pour Garmin).
 * Lecture sous les droits de l'utilisateur (RLS) ; contrôle de compatibilité, conversion et relecture
 * du fichier ; chaque tentative, réussie ou non, est inscrite à l'historique des exports.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  const session = await getSession();
  if (!session) return json(401, { error: "Connectez-vous pour télécharger cette séance." });
  const params = ParamsSchema.safeParse(await ctx.params);
  const query = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!params.success || !query.success) return json(400, { error: "Demande d'export invalide." });
  const { provider, segment: segmentIndex } = query.data;

  const detail = await getSessionDetail(session.supabase, params.data.sessionId);
  if (!detail) return json(404, { error: "Séance introuvable ou inaccessible." });
  if (detail.state === "cancelled") return json(409, { error: "Cette séance est annulée : il n'y a rien à exporter." });
  const workout = parseWorkout(detail.content);
  if (!workout.success) return json(422, { error: "Le contenu de la séance est invalide : ouvrez-la dans l'éditeur pour la corriger." });
  const segment = workout.data.segments[segmentIndex];
  if (!segment) return json(400, { error: "Cette partie de la séance n'existe pas." });

  const thresholds = await getThresholdsOn(session.supabase, detail.athlete_id, detail.scheduled_date);
  const connector = FILE_CONNECTORS[provider];
  const result = exportSegment(provider, segment, exportContext(detail, thresholds), { suffix: segmentSuffix(workout.data, segmentIndex) });
  const base = {
    sessionId: detail.id,
    provider,
    format: connector.info.format,
    segmentIndex,
    sessionVersion: detail.version,
    issues: result.issues,
  };

  if (!result.ok) {
    const reason = result.issues.find((i) => i.severity === "blocking");
    const error = reason ? `${reason.where ? `${reason.where} : ` : ""}${reason.message}` : "Conversion impossible.";
    const history = await recordExport(session.supabase, { ...base, status: "failed", error });
    return json(422, { error, issues: result.issues, history });
  }

  const history = await recordExport(session.supabase, { ...base, status: "succeeded", fileName: result.file.fileName, bytes: result.file.bytes });
  return new NextResponse(Buffer.from(result.file.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.file.mimeType,
      "Content-Disposition": `attachment; filename="${result.file.fileName}"`,
      "Content-Length": String(result.file.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-History": history,
      "X-Export-Losses": String(result.issues.filter((i) => i.severity === "loss").length),
    },
  });
}
