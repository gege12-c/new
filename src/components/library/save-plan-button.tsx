"use client";

import { BookmarkPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { saveTrainingPlan } from "@/app/(app)/plan-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatWeekRange } from "@/lib/planning/dates";

/** « Enregistrer en plan » : les semaines affichées du calendrier d’un athlète deviennent un plan réutilisable. */
export function SavePlanButton({ athleteId, monday, withImported = false }: { athleteId: string; monday: string; withImported?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState("4");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="hidden lg:inline-flex">
        <BookmarkPlus aria-hidden />
        Enregistrer en plan
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Enregistrer en plan">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => {
              const result = await saveTrainingPlan({ athleteId, from: monday, weeks: Number(weeks), name, description });
              if (result.status === "ok") {
                setMessage({ tone: "success", text: `Plan « ${name.trim()} » enregistré dans la bibliothèque.` });
                setName("");
                setDescription("");
              } else setMessage({ tone: "error", text: result.message });
            });
          }}
        >
          <p className="text-[14px] text-ink-soft">
            Les séances à partir de la semaine du {formatWeekRange(monday)} (publiées et brouillons, sans les séances annulées
            {withImported ? " ni celles d’intervals.icu" : ""}) deviennent un plan, à appliquer ensuite à n’importe quel athlète depuis la bibliothèque.
          </p>
          <Field label="Nom du plan" htmlFor="plan-name">
            <Input id="plan-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bloc seuil, 4 semaines" />
          </Field>
          <Field label="Nombre de semaines" htmlFor="plan-weeks">
            <Select id="plan-weeks" value={weeks} onChange={(e) => setWeeks(e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
                <option key={n} value={n}>
                  {n} semaine{n > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="plan-description" hint="Facultatif.">
            <Textarea id="plan-description" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
          </Field>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <Button type="submit" disabled={pending}>
              Enregistrer
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
