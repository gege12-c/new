import { deleteEvent } from "@/app/(app)/actions";
import { EVENT_SPORT_LABELS, PriorityBadge } from "@/components/sport";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { daysBetween, formatLocalDate } from "@/lib/utils";
import { EventForm } from "./event-form";

type EventRow = {
  id: string;
  name: string;
  event_date: string;
  priority: string;
  sport: string;
  distance_label: string | null;
  location: string | null;
};

export function EventsPanel({
  athleteId,
  events,
  today,
  canEdit,
}: {
  athleteId: string;
  events: EventRow[];
  today: string;
  canEdit: boolean;
}) {
  const upcoming = events.filter((e) => e.event_date >= today);
  const past = events.filter((e) => e.event_date < today).reverse();

  const row = (event: EventRow) => (
    <li key={event.id} className="flex items-center gap-3 py-3">
      <PriorityBadge priority={event.priority} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{event.name}</p>
        <p className="text-sm text-muted">
          {formatLocalDate(event.event_date)}
          {", "}
          {[EVENT_SPORT_LABELS[event.sport], event.distance_label, event.location].filter(Boolean).join(", ")}
        </p>
      </div>
      {event.event_date >= today ? (
        <span className="tabular shrink-0 text-sm font-semibold">J-{daysBetween(today, event.event_date)}</span>
      ) : null}
      {canEdit ? (
        <form action={deleteEvent}>
          <input type="hidden" name="id" value={event.id} />
          <ConfirmSubmit size="sm" variant="ghost" confirmMessage={`Supprimer « ${event.name} » ?`}>
            Supprimer
          </ConfirmSubmit>
        </form>
      ) : null}
    </li>
  );

  return (
    <Panel title="Compétitions" description="Les courses visées structurent la saison et la planification.">
      {upcoming.length === 0 ? (
        <EmptyState title="Aucune compétition à venir">Ajoutez l’objectif de la saison pour que le plan s’organise autour.</EmptyState>
      ) : (
        <ul className="-my-3 divide-y divide-line">{upcoming.map(row)}</ul>
      )}

      {past.length > 0 ? (
        <details className="mt-4 border-t border-line pt-4">
          <summary className="cursor-pointer text-[14px] font-semibold text-ink-soft hover:text-ink">Compétitions passées ({past.length})</summary>
          <ul className="divide-y divide-line">{past.map(row)}</ul>
        </details>
      ) : null}

      {canEdit ? (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-3 text-[15px] font-semibold">Nouvelle compétition</h3>
          <EventForm athleteId={athleteId} today={today} />
        </div>
      ) : null}
    </Panel>
  );
}
