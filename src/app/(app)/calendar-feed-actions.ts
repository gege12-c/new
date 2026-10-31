"use server";

/** Adresse d'abonnement de l'agenda du téléphone : créée, remplacée ou retirée par l'athlète. */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { done, fail, type ActionState } from "@/lib/action-state";
import { getSession } from "@/lib/auth/dal";
import { friendlyError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";

export async function createCalendarFeed(): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { data, error } = await session.supabase.rpc("create_calendar_feed");
  if (error || !data) return fail(friendlyError(error));
  const site = await getSiteUrl();
  refresh();
  return done("Adresse créée.", { url: `${site}/api/calendar/${data}.ics` });
}

export async function revokeCalendarFeed(): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { error } = await session.supabase.rpc("revoke_calendar_feed");
  if (error) return fail(friendlyError(error));
  refresh();
  return done("Adresse retirée : votre agenda ne reçoit plus vos séances.");
}
