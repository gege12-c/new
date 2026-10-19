import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { bearerToken, loadWatchData, UNAVAILABLE, WatchUnavailableError, watchJson } from "@/lib/watch/http";
import { watchFitFile } from "@/lib/watch/sessions";

const ParamsSchema = z.object({ sessionId: z.uuid() });
const QuerySchema = z.object({ part: z.coerce.number().int().min(0).max(5).default(0) });

/**
 * Fichier FIT de séance (une partie d'un enchaînement) pour la montre : la montre l'enregistre dans
 * ses séances et le lance avec ses propres écrans. Même conversion et même relecture que le
 * téléchargement manuel ; rien n'est servi si le fichier ne passe pas la relecture.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  const token = bearerToken(request);
  if (!token) return watchJson({ status: "unauthorized" }, 401);
  const params = ParamsSchema.safeParse(await ctx.params);
  const query = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!params.success || !query.success) return watchJson({ status: "invalid" }, 400);
  try {
    const data = await loadWatchData(token);
    if (!data) return watchJson({ status: "unauthorized" }, 401);
    const result = watchFitFile(data, params.data.sessionId, query.data.part);
    if (!result.ok) return watchJson({ status: "unavailable", message: result.error }, result.status);
    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ant.fit",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Length": String(result.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof WatchUnavailableError) return watchJson(UNAVAILABLE, 503);
    throw error;
  }
}
