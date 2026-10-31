import { PanelFrame } from "@/components/planning/panel-frame";
import { getCalendarNote } from "@/lib/data/notes";
import { formatFullDate } from "@/lib/planning/dates";
import { NOTE_LABELS, noteTitle } from "@/lib/planning/notes";
import type { ServerSupabase } from "@/lib/supabase/server";
import { NoteForm } from "./note-form";

/**
 * Note de calendrier ou jour indisponible, ouvert depuis le calendrier : modifiable par son auteur
 * (et par l’athlète sur son calendrier), en lecture seule sinon ; « new » pour en poser une.
 */
export async function NotePanel({
  supabase,
  noteId,
  athleteId,
  viewerId,
  canWrite,
  defaultDate,
  closeHref,
}: {
  supabase: ServerSupabase;
  noteId: string;
  athleteId: string;
  viewerId: string;
  /** L’athlète lui-même, ou un coach qui planifie pour lui. */
  canWrite: boolean;
  defaultDate: string;
  closeHref: string;
}) {
  const self = viewerId === athleteId;
  if (noteId === "new") {
    return (
      <PanelFrame closeHref={closeHref} title="Nouvelle note">
        <div className="space-y-4">
          <h2 className="display pr-10 text-[24px]">Indisponibilité ou note</h2>
          <p className="text-[14px] text-ink-soft">
            {self
              ? "Prévenez votre coach des jours où vous ne pourrez pas vous entraîner comme prévu (rotation, déplacement, maladie) : il les voit dans votre calendrier."
              : "Posée sur le calendrier de l’athlète, visible de lui et de ses coachs."}
          </p>
          {canWrite ? (
            <NoteForm note={null} athleteId={athleteId} defaultDate={defaultDate} closeHref={closeHref} self={self} />
          ) : (
            <p className="text-[14px] text-muted">Vous ne planifiez pas pour cet athlète : vous ne pouvez pas poser de note.</p>
          )}
        </div>
      </PanelFrame>
    );
  }

  const note = await getCalendarNote(supabase, noteId);
  if (!note) {
    return (
      <PanelFrame closeHref={closeHref} title="Note introuvable">
        <p className="pr-10 text-[14px] text-muted">Cette note n’existe plus ou ne vous est pas accessible.</p>
      </PanelFrame>
    );
  }
  const editable = canWrite && (note.created_by === viewerId || self);
  const author = note.created_by === viewerId ? "vous" : note.created_by === athleteId ? "l’athlète" : "un coach";
  const period = note.start_date === note.end_date ? `le ${formatFullDate(note.start_date)}` : `du ${formatFullDate(note.start_date)} au ${formatFullDate(note.end_date)}`;
  return (
    <PanelFrame closeHref={closeHref} title={noteTitle(note)}>
      <div className="space-y-4">
        <div className="pr-10">
          <p className="text-[13px] font-semibold text-muted">{NOTE_LABELS[note.kind]}</p>
          <h2 className="display text-[24px]">{note.title ?? NOTE_LABELS[note.kind]}</h2>
          <p className="mt-1 text-[14px] text-ink-soft">
            {period.charAt(0).toUpperCase() + period.slice(1)}, posée par {author}.
          </p>
        </div>
        {editable ? (
          <NoteForm note={note} athleteId={athleteId} defaultDate={note.start_date} closeHref={closeHref} self={self} />
        ) : note.note ? (
          <p className="whitespace-pre-line text-[15px] text-ink">{note.note}</p>
        ) : null}
      </div>
    </PanelFrame>
  );
}
