"use client";

import { Archive, CalendarPlus, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveTemplate } from "@/app/(app)/planning-actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { controlClasses, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** Actions d’un modèle : le planifier pour un athlète (ouvre l’éditeur prérempli), le modifier, l’archiver. */
export function TemplateActions({ templateId, athletes, today }: { templateId: string; athletes: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [planning, setPlanning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [athleteId, setAthleteId] = useState(athletes[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setPlanning(true)} disabled={!athletes.length} title={athletes.length ? undefined : "Aucun athlète ne vous autorise à planifier"}>
        <CalendarPlus aria-hidden />
        Planifier
      </Button>
      <ButtonLink href={`/coach/library/${templateId}`} size="sm" variant="secondary">
        <PencilLine aria-hidden />
        Modifier
      </ButtonLink>
      <Button size="sm" variant="ghost" onClick={() => setArchiving(true)} aria-label="Archiver le modèle">
        <Archive aria-hidden />
      </Button>

      <Dialog open={planning} onClose={() => setPlanning(false)} title="Planifier ce modèle">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(`/coach/athletes/${athleteId}/sessions/new?template=${templateId}&date=${date}`);
          }}
        >
          <p className="text-[14px] text-ink-soft">L’éditeur s’ouvre avec le modèle : ajustez-le pour l’athlète, puis publiez.</p>
          <div className="space-y-1.5">
            <label htmlFor={`athlete-${templateId}`} className="block text-[13px] font-semibold text-ink-soft">
              Athlète
            </label>
            <Select id={`athlete-${templateId}`} value={athleteId} onChange={(event) => setAthleteId(event.target.value)}>
              {athletes.map((athlete) => (
                <option key={athlete.id} value={athlete.id}>
                  {athlete.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`date-${templateId}`} className="block text-[13px] font-semibold text-ink-soft">
              Date
            </label>
            <input id={`date-${templateId}`} type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} className={cn(controlClasses, "h-10")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPlanning(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={!athleteId}>
              Ouvrir l’éditeur
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={archiving}
        title="Archiver ce modèle ?"
        confirmLabel="Archiver"
        pending={pending}
        onCancel={() => setArchiving(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await archiveTemplate(templateId);
            if (result.status === "ok") setArchiving(false);
            else setError(result.message);
          })
        }
      >
        Il disparaît de la bibliothèque. Les séances déjà planifiées à partir de ce modèle ne changent pas.
        {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      </ConfirmDialog>
    </div>
  );
}
