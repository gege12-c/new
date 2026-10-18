/** Chargement d’un athlète suivi par le coach connecté ; 404 sans relation active (la RLS ne renverrait rien). */
import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getAthleteProfile } from "@/lib/data/athlete";
import { getCoachLink } from "@/lib/data/coach";
import { todayIn } from "@/lib/time";

export async function loadCoachedAthlete(athleteId: string, next: string) {
  if (!z.uuid().safeParse(athleteId).success) notFound();
  const [session, coach] = await Promise.all([requireSession(next), getProfile()]);
  const link = await getCoachLink(session.supabase, session.userId, athleteId);
  if (!link) notFound();
  const [{ data: athlete }, athleteProfile] = await Promise.all([
    session.supabase.from("profiles").select("id, display_name, timezone").eq("id", athleteId).single(),
    getAthleteProfile(session.supabase, athleteId),
  ]);
  if (!athlete) notFound();
  return {
    ...session,
    coach,
    link,
    athlete,
    athleteProfile,
    canPlan: link.can_edit_plan,
    today: await todayIn(athlete.timezone),
  };
}
