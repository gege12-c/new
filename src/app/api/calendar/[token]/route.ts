import { buildCalendar, CalendarFeedSchema } from "@/lib/calendar/ics";
import { getSiteUrl } from "@/lib/site";
import { isMissingSchema } from "@/lib/supabase/schema";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Agenda du téléphone (iCalendar) : lu sans compte par Google Agenda, Apple Calendrier ou Outlook ;
 * le jeton secret de l'adresse est la seule clé (son empreinte est vérifiée par la base).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "").toLowerCase();
  const notFound = () => new Response("Agenda introuvable : cette adresse a été retirée ou remplacée.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!/^[0-9a-f]{64}$/.test(token)) return notFound();

  const { data, error } = await createPublicClient().rpc("calendar_feed", { p_token: token });
  if (isMissingSchema(error)) return new Response("TriCoach est en cours de mise à jour : réessayez plus tard.\n", { status: 503, headers: { "Retry-After": "3600" } });
  if (error) throw error;
  const feed = CalendarFeedSchema.parse(data);
  if (feed.status !== "ok") return notFound();

  const body = buildCalendar(feed, { siteUrl: await getSiteUrl(), now: new Date() });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="tricoach.ics"',
      // Données de l'athlète : jamais en cache partagé.
      "Cache-Control": "private, max-age=300",
    },
  });
}
