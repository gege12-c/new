"use client";

import { FileUp } from "lucide-react";
import { useRef, useState, useTransition, type DragEvent } from "react";
import { importActivities, reportImportFailure } from "@/app/(app)/activity-actions";
import { cn } from "@/lib/utils";

type Line = { name: string; tone: "success" | "error" | "info"; text: string };

const MAX_FILES = 10;

/**
 * Import de fichiers d’activité FIT (montre, compteur, Garmin Connect…), aussi en .zip ou .fit.gz.
 * Le fichier est lu sur l’appareil : seul le résumé de chaque activité part au serveur.
 */
export function FitImport() {
  const input = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();

  const handle = (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, MAX_FILES);
    start(async () => {
      const [{ fitFilesFrom }, { parseFitFile, FitImportError }] = await Promise.all([import("@/lib/fit/archive"), import("@/lib/fit/parse")]);
      const out: Line[] = list.length > MAX_FILES ? [{ name: "", tone: "info", text: `${MAX_FILES} fichiers au plus à la fois : les suivants sont ignorés.` }] : [];
      for (const file of files) {
        try {
          for (const fit of await fitFilesFrom(file.name, await file.arrayBuffer())) {
            const items = await parseFitFile(fit.data);
            const result = await importActivities(items);
            if (result.status === "error") {
              out.push({ name: fit.name, tone: "error", text: result.message });
            } else if (result.imported === 0) {
              out.push({ name: fit.name, tone: "info", text: "Déjà importé : rien n’a changé." });
            } else {
              const parts = [`${result.imported} activité${result.imported > 1 ? "s" : ""} importée${result.imported > 1 ? "s" : ""}`];
              if (result.duplicates) parts.push(`${result.duplicates} déjà présente${result.duplicates > 1 ? "s" : ""}`);
              out.push({ name: fit.name, tone: "success", text: `${parts.join(", ")}.` });
            }
          }
        } catch (error) {
          const text = error instanceof FitImportError ? error.message : "Fichier illisible.";
          out.push({ name: file.name, tone: "error", text });
          void reportImportFailure(text).catch(() => undefined);
        }
      }
      setLines(out);
      if (input.current) input.current.value = "";
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    handle(event.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1.5 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center transition-colors hover:bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink",
          over && "border-ink bg-surface-2",
          pending && "pointer-events-none opacity-60",
        )}
      >
        <FileUp className="size-6 text-muted" aria-hidden />
        <span className="text-[14px] font-semibold">{pending ? "Lecture des fichiers…" : "Choisir des fichiers FIT"}</span>
        <span className="text-[12.5px] text-muted">ou les déposer ici : .fit, .zip de Garmin Connect, .fit.gz</span>
        <input
          ref={input}
          type="file"
          multiple
          accept=".fit,.FIT,.zip,.gz,application/zip,application/gzip,application/octet-stream"
          className="sr-only"
          onChange={(event) => handle(event.target.files)}
          disabled={pending}
        />
      </label>
      {lines.length ? (
        <ul className="space-y-1.5" aria-live="polite">
          {lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="flex gap-2 text-[13px] leading-snug">
              <span
                aria-hidden
                className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", line.tone === "success" ? "bg-success" : line.tone === "error" ? "bg-danger" : "bg-line-strong")}
              />
              <span>
                {line.name ? <span className="font-semibold text-ink">{line.name} : </span> : null}
                <span className={line.tone === "error" ? "text-danger" : "text-ink-soft"}>{line.text}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
