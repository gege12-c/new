/**
 * Heure courante côté serveur. Avec Cache Components, l’heure n’est lue qu’à la requête
 * (connection()), jamais pendant un pré-rendu : sinon la date du jour serait figée.
 */
import "server-only";
import { connection } from "next/server";
import { localDate } from "./utils";

/** Date du jour (AAAA-MM-JJ) dans le fuseau de l’utilisateur. */
export async function todayIn(timeZone: string): Promise<string> {
  await connection();
  return localDate(timeZone);
}

export async function nowIso(): Promise<string> {
  await connection();
  return new Date().toISOString();
}
