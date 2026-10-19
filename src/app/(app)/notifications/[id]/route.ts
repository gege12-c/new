import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { getNotifications } from "@/lib/data/notifications";
import { notificationTarget } from "@/lib/notifications/messages";

/** Ouvre une notification : la marque comme lue, puis mène à la séance (ou au profil pour Strava). */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/notifications", request.url));
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.redirect(new URL("/notifications", request.url));
  const items = await getNotifications(session.supabase, 200);
  const item = items?.find((n) => n.id === id);
  if (!item) return NextResponse.redirect(new URL("/notifications", request.url));
  if (!item.read_at) {
    const { error } = await session.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) console.error("notification read", error.code, error.message);
  }
  return NextResponse.redirect(new URL(notificationTarget(item, session.userId), request.url));
}
