import { Panel } from "@/components/ui/panel";
import { isMissingSchema, SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { CalendarFeedControls } from "./calendar-feed-controls";

const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

/** Agenda du téléphone : séances publiées, compétitions et jours indisponibles, par abonnement. */
export async function CalendarFeedPanel({ supabase, userId, timeZone }: { supabase: ServerSupabase; userId: string; timeZone: string }) {
  const { data, error } = await supabase.from("calendar_feeds").select("created_at, last_read_at").eq("athlete_id", userId).maybeSingle();
  const pending = isMissingSchema(error);
  if (error && !pending) throw error;
  return (
    <Panel
      id="agenda"
      title="Agenda du téléphone"
      description="Vos séances publiées, compétitions et jours indisponibles dans Google Agenda, le Calendrier de l’iPhone ou Outlook, à côté de vos autres rendez-vous. Mis à jour par votre agenda lui-même (en général toutes les quelques heures)."
      className="scroll-mt-20 lg:scroll-mt-6"
    >
      {pending ? (
        <p className="text-[14px] text-muted">{SCHEMA_PENDING_MESSAGE}</p>
      ) : (
        <div className="space-y-4">
          {data ? (
            <p className="text-[13.5px] text-ink-soft">
              Adresse créée le {when(data.created_at, timeZone)}
              {data.last_read_at ? `, lue par votre agenda le ${when(data.last_read_at, timeZone)}` : ", pas encore lue par un agenda"}.
            </p>
          ) : null}
          <CalendarFeedControls exists={Boolean(data)} />
          <details className="text-[13.5px] text-ink-soft">
            <summary className="cursor-pointer font-semibold hover:text-ink">S’abonner, pas à pas</summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                Google Agenda (Android) : sur un ordinateur, calendar.google.com, « Autres agendas », « + », « À partir de l’URL », collez l’adresse. Elle apparaît
                ensuite sur le téléphone.
              </li>
              <li>iPhone : « S’abonner », ou Réglages, Calendrier, Comptes, Ajouter un compte, Autre, « Ajouter un calendrier avec abonnement ».</li>
              <li>Outlook : Ajouter un calendrier, « S’abonner à partir du web », collez l’adresse.</li>
            </ul>
          </details>
        </div>
      )}
    </Panel>
  );
}
