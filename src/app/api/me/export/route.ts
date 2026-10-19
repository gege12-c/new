import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { buildPersonalExport } from "@/lib/data/personal-export";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Téléchargement de toutes les données du compte connecté (fichier JSON), lues sous ses droits.
 * Rien n'est mis en cache, ni ici ni dans le navigateur.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Connectez-vous pour télécharger vos données." }, { status: 401, headers });
  try {
    const result = await buildPersonalExport(session);
    const day = result.exported_at.slice(0, 10);
    return new NextResponse(JSON.stringify(result, null, 2), {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="tricoach-mes-donnees-${day}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "L'export n'a pas abouti. Réessayez dans un instant." }, { status: 500, headers });
  }
}
