"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { deleteCalendarNote, saveCalendarNote } from "@/app/(app)/note-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { idle, type ActionState } from "@/lib/action-state";
import { NOTE_HINTS, NOTE_KINDS, NOTE_LABELS, type CalendarNote, type NoteKind } from "@/lib/planning/notes";

/**
 * Poser ou modifier une note de calendrier. Champs contrôlés : une saisie refusée par le serveur
 * reste en place (React remet à zéro les champs libres d’un formulaire envoyé).
 */
export function NoteForm({
  note,
  athleteId,
  defaultDate,
  closeHref,
  self,
}: {
  note: CalendarNote | null;
  athleteId: string;
  defaultDate: string;
  closeHref: string;
  /** L’athlète pose la note sur son propre calendrier (sinon : un coach). */
  self: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(saveCalendarNote, idle);
  const [kind, setKind] = useState<NoteKind>(note?.kind ?? "unavailable");
  const [start, setStart] = useState(note?.start_date ?? defaultDate);
  const [end, setEnd] = useState(note?.end_date ?? defaultDate);
  const [title, setTitle] = useState(note?.title ?? "");
  const [text, setText] = useState(note?.note ?? "");
  const [confirming, setConfirming] = useState(false);
  const [removal, setRemoval] = useState<ActionState>(idle);
  const [removing, startRemoving] = useTransition();

  useEffect(() => {
    if (state.status === "success") router.push(closeHref, { scroll: false });
  }, [state, closeHref, router]);

  return (
    <form action={action} className="space-y-4">
      {note ? <input type="hidden" name="id" value={note.id} /> : null}
      <input type="hidden" name="athlete_id" value={athleteId} />
      <Field label="Type" htmlFor="note-kind" hint={NOTE_HINTS[kind]}>
        <Select id="note-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
          {NOTE_KINDS.map((k) => (
            <option key={k} value={k}>
              {NOTE_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Du" htmlFor="note-start">
          <Input
            id="note-start"
            name="start_date"
            type="date"
            required
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value && end < e.target.value) setEnd(e.target.value);
            }}
          />
        </Field>
        <Field label="Au (inclus)" htmlFor="note-end">
          <Input id="note-end" name="end_date" type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Intitulé" htmlFor="note-title" hint="Facultatif.">
        <Input
          id="note-title"
          name="title"
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "unavailable" ? "Rotation Tokyo" : kind === "travel" ? "Séminaire à Lyon" : ""}
        />
      </Field>
      <Field label="Précisions" htmlFor="note-text" hint={self ? "Visibles de vos coachs." : "Visibles de l’athlète et de ses autres coachs."}>
        <Textarea
          id="note-text"
          name="note"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "travel" ? "Piscine de l’hôtel, pas de vélo." : ""}
        />
      </Field>
      <FormMessage state={state.status === "error" ? state : removal} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubmitButton>{note ? "Enregistrer" : "Poser la note"}</SubmitButton>
        {note ? (
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            Retirer
          </Button>
        ) : null}
      </div>
      {note ? (
        <ConfirmDialog
          open={confirming}
          title="Retirer cette note ?"
          confirmLabel="Retirer"
          pending={removing}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            startRemoving(async () => {
              const data = new FormData();
              data.set("id", note.id);
              const result = await deleteCalendarNote(idle, data);
              setConfirming(false);
              if (result.status === "success") router.push(closeHref, { scroll: false });
              else setRemoval(result);
            })
          }
        >
          Elle disparaît du calendrier, pour vous comme pour {self ? "vos coachs" : "l’athlète"}.
        </ConfirmDialog>
      ) : null}
    </form>
  );
}
