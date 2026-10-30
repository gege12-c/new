"use server";

/**
 * Actions de l'athlète sur sa montre Suunto : envoi immédiat d'une séance, déconnexion du compte.
 * Les droits sont vérifiés par la base (la séance est relue sous la RLS de l'utilisateur).
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { getSiteUrl } from "@/lib/site";
import type { CompatibilityIssue } from "@/lib/export/types";
import { suuntoDeps } from "@/lib/suunto/deps";
import { disconnectSuunto, pushSession } from "@/lib/suunto/service";

export type SuuntoPushOutcome =
  | { status: "ok"; message: string; issues: CompatibilityIssue[] }
  | { status: "error"; message: string; issues?: CompatibilityIssue[] };

const NOT_CONFIGURED = "L’envoi vers Suunto n’est pas encore configuré sur ce site.";

/** Envoie (ou met à jour) la séance sur la montre, sans attendre la file de jobs. */
export async function pushSessionToSuunto(sessionId: string): Promise<SuuntoPushOutcome> {
  const session = await getSession();
  if (!session)
    return {
      status: "error",
      message: "Votre session a expiré : reconnectez-vous.",
    };
  const parsed = z.uuid().safeParse(sessionId);
  if (!parsed.success) return { status: "error", message: "Séance inconnue." };
  const deps = suuntoDeps(await getSiteUrl());
  if (!deps) return { status: "error", message: NOT_CONFIGURED };

  // Relue sous les droits de l'athlète : seule une séance à lui (et pas celle d'un autre) peut partir sur sa montre.
  const { data: own } = await session.supabase.from("planned_sessions").select("id, athlete_id").eq("id", parsed.data).maybeSingle();
  if (!own || own.athlete_id !== session.userId)
    return {
      status: "error",
      message: "Seul l’athlète peut envoyer une séance sur sa propre montre.",
    };

  try {
    const result = await pushSession(deps, session.userId, parsed.data);
    refresh();
    if (result.status === "skipped") {
      return {
        status: "error",
        message: result.reason === "not_connected" ? "Connectez d’abord votre compte Suunto (Profil sportif, « Montre Suunto »)." : "Séance introuvable.",
      };
    }
    if (result.status === "removed") {
      const why = {
        cancelled: "elle est annulée",
        unpublished: "elle n’est pas publiée",
        out_of_window: "elle est passée, ou à plus de 14 jours",
        invalid: "son contenu est invalide",
      }[result.reason];
      return {
        status: "error",
        message: `Cette séance n’est pas envoyée sur la montre : ${why}. Si elle y était, elle en a été retirée.`,
      };
    }
    const failed = result.segments.filter((s) => s.status === "failed");
    const issues = result.segments.flatMap((s) => (s.status === "removed" ? [] : s.issues));
    if (failed.length) {
      return {
        status: "error",
        message: `Suunto n’a pas accepté ${failed.length > 1 ? "certaines parties" : "la séance"} : ${failed.map((s) => s.error).join(" ; ")}`,
        issues,
      };
    }
    const sent = result.segments.filter((s) => s.status === "sent").length;
    return {
      status: "ok",
      message: `${sent > 1 ? `${sent} guides envoyés` : "Séance envoyée"} sur votre compte Suunto : ouvrez l’appli Suunto sur votre téléphone pour la synchroniser avec la montre.`,
      issues,
    };
  } catch (error) {
    refresh();
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    return {
      status: "error",
      message: /Reconnexion/.test(message) ? "Suunto a refusé l’accès de TriCoach : reconnectez votre compte (Profil sportif, « Montre Suunto »)." : message,
    };
  }
}

export async function disconnectSuuntoAction(): Promise<{ status: "ok"; message: string; guidesLeft: number } | { status: "error"; message: string }> {
  const session = await getSession();
  if (!session)
    return {
      status: "error",
      message: "Votre session a expiré : reconnectez-vous.",
    };
  const deps = suuntoDeps(await getSiteUrl());
  if (!deps) return { status: "error", message: NOT_CONFIGURED };
  const { removed, failed } = await disconnectSuunto(deps, session.userId);
  refresh();
  return {
    status: "ok",
    guidesLeft: failed,
    message: failed
      ? `Compte Suunto déconnecté ; ${removed} guide${removed > 1 ? "s" : ""} retiré${removed > 1 ? "s" : ""}, ${failed} non retiré${failed > 1 ? "s" : ""} : supprimez-le${failed > 1 ? "s" : ""} dans l’appli Suunto (SuuntoPlus, Guides).`
      : `Compte Suunto déconnecté${removed ? ` ; ${removed} guide${removed > 1 ? "s" : ""} retiré${removed > 1 ? "s" : ""} de votre compte Suunto` : ""}.`,
  };
}
