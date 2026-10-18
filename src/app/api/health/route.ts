import { connection } from "next/server";
import { checkHealth } from "@/lib/health";

/** Production status: Supabase configuration and public auth settings. Exposes no private data. */
export async function GET() {
  await connection();
  const report = await checkHealth();
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
