"use server";

/**
 * Suppression du compte par son titulaire. L'accès Strava est révoqué d'abord (seule l'application
 * déchiffre les jetons), puis la base efface le compte et tout ce qui lui appartient, en une
 * transaction (`delete_my_account`), sous la seule identité de l'utilisateur connecté.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { DELETE_CONFIRMATION } from "@/lib/account";
import { fail, firstIssue, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { stravaDeps } from "@/lib/strava/deps";
import { disconnectStrava } from "@/lib/strava/service";
import { isMissingSchema, SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";

const ConfirmSchema = z.object({
  confirm: z
    .string()
    .trim()
    .refine((value) => value.toUpperCase() === DELETE_CONFIRMATION, `Tapez ${DELETE_CONFIRMATION} pour confirmer.`),
});

export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ConfirmSchema.safeParse({ confirm: formData.get("confirm") ?? "" });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const session = await getSession();
  if (!session) redirect("/login");
  const { supabase, userId } = session;

  let stravaRevoked = true;
  const { data: connection, error: readError } = await supabase.from("external_connections").select("id").eq("provider", "strava").maybeSingle();
  if (readError && !isMissingSchema(readError)) return fail(friendlyError(readError));
  if (connection) {
    const deps = stravaDeps();
    try {
      stravaRevoked = deps ? (await disconnectStrava(deps, userId)).revoked : false;
    } catch {
      // La connexion et les jetons partent de toute façon avec le compte ; l'athlète est prévenu.
      stravaRevoked = false;
    }
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    if (isMissingSchema(error)) return fail(SCHEMA_PENDING_MESSAGE);
    const intact = connection ? "Votre compte est intact, Strava a été déconnecté." : "Votre compte est intact.";
    return fail(`${friendlyError(error, "La suppression n’a pas abouti.")} ${intact} Réessayez.`);
  }
  // Le compte n'existe plus : la session de cet appareil est effacée (les autres expirent d'elles-mêmes).
  await supabase.auth.signOut().catch(() => undefined);
  redirect(stravaRevoked ? "/login?deleted=1" : "/login?deleted=strava");
}
