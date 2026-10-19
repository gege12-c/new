"use client";

import { AlertTriangle, Check, ClipboardCopy, Download, Info, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import type { ExportHistoryEntry } from "@/lib/data/exports";
import { GARMIN, SUUNTO, WAHOO, ZWIFT, type ConnectorInfo } from "@/lib/export/providers";
import type { SuuntoPlan } from "@/lib/export/suunto-steps";
import type { CompatibilityIssue, CompatibilityReport, FileProviderId } from "@/lib/export/types";
import { SPORT_LABELS } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";
import { SuuntoSteps } from "./suunto-steps";

type Download =
  | { status: "loading" }
  | { status: "done"; fileName: string; history: string | null }
  | { status: "error"; message: string };

const FILE_PROVIDERS: Record<FileProviderId, ConnectorInfo> = { zwift: ZWIFT, garmin: GARMIN };
const FILE_LABEL: Record<FileProviderId, string> = { zwift: "fichier .zwo", garmin: "fichier FIT de séance" };

const keyOf = (r: Pick<CompatibilityReport, "provider" | "segmentIndex">) => `${r.provider}:${r.segmentIndex}`;

function fileNameFrom(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1] : null;
}

function IssueLine({ issue }: { issue: CompatibilityIssue }) {
  const Icon = issue.severity === "blocking" ? XCircle : issue.severity === "loss" ? AlertTriangle : Info;
  return (
    <li className="flex gap-2 text-[13px] leading-snug">
      <Icon
        aria-hidden
        className={cn("mt-[2px] size-3.5 shrink-0", issue.severity === "blocking" ? "text-danger" : issue.severity === "loss" ? "text-warning" : "text-muted")}
      />
      <span className={issue.severity === "info" ? "text-muted" : "text-ink-soft"}>
        {issue.where ? <span className="font-medium text-ink">{issue.where} : </span> : null}
        {issue.message}
      </span>
    </li>
  );
}

const ORDER = { blocking: 0, loss: 1, info: 2 } as const;

function verdict(report: CompatibilityReport): { label: string; tone: string } {
  if (!report.ok) return { label: "export impossible", tone: "text-danger" };
  const losses = report.issues.filter((i) => i.severity === "loss").length;
  if (losses) return { label: `compatible, ${losses} approximation${losses > 1 ? "s" : ""}`, tone: "text-warning" };
  return { label: "compatible, sans perte", tone: "text-success" };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Résumé du contrôle de compatibilité : ce qui passe, ce qui est approché, ce qui bloque. */
function Compatibility({ reports }: { reports: CompatibilityReport[] }) {
  const multi = reports.length > 1;
  const hasDetail = reports.some((r) => r.issues.length);
  // Détail rendu à l'ouverture seulement (il cite les étapes de la séance).
  const [open, setOpen] = useState(false);
  return (
    <details className="group mt-2" data-compatibility onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer list-none text-[13px] leading-snug [&::-webkit-details-marker]:hidden">
        {reports.map((report, i) => {
          const v = verdict(report);
          return (
            <span key={report.segmentIndex}>
              {i ? <span className="text-muted"> · </span> : null}
              {multi ? <span className="text-ink-soft">{SPORT_LABELS[report.sport]} : </span> : null}
              <span className={cn("font-semibold", v.tone)}>{multi ? v.label : capitalize(v.label)}</span>
            </span>
          );
        })}
        {hasDetail ? (
          <>
            {" "}
            <span className="text-muted underline decoration-line-strong underline-offset-4 group-open:hidden">voir le détail</span>
            <span className="hidden text-muted underline decoration-line-strong underline-offset-4 group-open:inline">masquer</span>
          </>
        ) : null}
      </summary>
      {hasDetail && open ? (
        <div className="mt-2 space-y-2 rounded-[10px] bg-surface-2 p-2.5">
          {reports
            .filter((r) => r.issues.length)
            .map((report) => (
              <div key={report.segmentIndex}>
                {multi ? <p className="mb-1 text-[12px] font-semibold text-ink-soft">{SPORT_LABELS[report.sport]}</p> : null}
                <ul className="space-y-1.5">
                  {[...report.issues]
                    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
                    .map((issue, i) => (
                      <IssueLine key={i} issue={issue} />
                    ))}
                </ul>
              </div>
            ))}
        </div>
      ) : null}
    </details>
  );
}

function Procedure({ info }: { info: ConnectorInfo }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">Comment l’importer dans {info.name}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-snug text-ink-soft">
        {info.procedure.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-muted">
        Source :{" "}
        {info.sources.map((s, i) => (
          <span key={s.url}>
            {i ? ", " : null}
            <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
              {s.label}
            </a>
          </span>
        ))}
      </p>
    </details>
  );
}

function historyNote(history: string | null): string | null {
  if (history === "unavailable") return "L’historique des exports sera disponible après la mise à jour de la base de données du site.";
  if (history === "failed") return "Le fichier est valide, mais son export n’a pas pu être inscrit à l’historique.";
  return null;
}

/** Exports d'une séance prévue : contrôle de compatibilité, téléchargement, relance, procédures. */
export function ExportSection({
  sessionId,
  version,
  reports,
  history,
  sheet,
  suunto,
  dateLabel,
  multiSegment,
  timeZone,
}: {
  sessionId: string;
  version: number;
  reports: CompatibilityReport[];
  history: ExportHistoryEntry[] | null;
  sheet: string;
  /** La séance écrite comme le créateur d'entraînements de l'application Suunto. */
  suunto: SuuntoPlan;
  /** Date de la séance, en toutes lettres (à reporter dans Suunto). */
  dateLabel: string;
  multiSegment: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [downloads, setDownloads] = useState<Record<string, Download>>({});
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);
  // La fiche n'est rendue qu'à l'ouverture : elle reprend tout le texte de la séance.
  const [sheetOpen, setSheetOpen] = useState(false);
  // De même pour les étapes Suunto, gardées ensuite (les étapes cochées restent cochées).
  const [suuntoShown, setSuuntoShown] = useState(false);

  const set = (key: string, value: Download) => setDownloads((current) => ({ ...current, [key]: value }));

  async function download(report: CompatibilityReport) {
    const key = keyOf(report);
    set(key, { status: "loading" });
    try {
      const response = await fetch(`/api/exports/${sessionId}?provider=${report.provider}&segment=${report.segmentIndex}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        set(key, { status: "error", message: body?.error ?? `Le téléchargement a échoué (erreur ${response.status}).` });
        router.refresh();
        return;
      }
      const blob = await response.blob();
      const fileName = fileNameFrom(response.headers.get("Content-Disposition")) ?? report.fileName ?? "seance";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      set(key, { status: "done", fileName, history: response.headers.get("X-Export-History") });
      router.refresh();
    } catch {
      set(key, { status: "error", message: "Connexion impossible : vérifiez votre réseau, puis réessayez." });
    }
  }

  async function copySheet() {
    try {
      await navigator.clipboard.writeText(sheet);
      setCopied("ok");
    } catch {
      setCopied("error");
    }
  }

  const providers = (["zwift", "garmin"] as const).map((id) => ({ id, info: FILE_PROVIDERS[id], reports: reports.filter((r) => r.provider === id) }));
  const stamp = (iso: string) =>
    new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

  return (
    <section aria-labelledby="export-title">
      <h3 id="export-title" className="heading text-[16px]">
        Exporter vers mes appareils
      </h3>
      <ul className="mt-2 divide-y divide-line rounded-[12px] border border-line">
        {providers.map(({ id, info, reports: list }) => (
          <li key={id} className="p-3" data-export-provider={id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink">
                  {info.name} <span className="font-normal text-muted">· {FILE_LABEL[id]}</span>
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{info.capabilities.planned.detail}</p>
              </div>
              {list.length ? (
                <div className="flex flex-wrap gap-2">
                  {list.map((report) => {
                    const state = downloads[keyOf(report)];
                    const label = multiSegment ? SPORT_LABELS[report.sport] : `Télécharger le ${id === "zwift" ? ".zwo" : "FIT"}`;
                    return (
                      <Button
                        key={keyOf(report)}
                        size="sm"
                        variant={report.ok ? "secondary" : "ghost"}
                        disabled={!report.ok || state?.status === "loading"}
                        onClick={() => download(report)}
                        aria-label={`${info.name} : ${multiSegment ? `télécharger la partie ${SPORT_LABELS[report.sport].toLowerCase()}` : label}`}
                      >
                        <Download aria-hidden />
                        {state?.status === "loading" ? "Préparation…" : label}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {list.length ? (
              <Compatibility reports={list} />
            ) : (
              <p className="mt-2 text-[13px] text-muted">{info.name} ne prend pas en charge les disciplines de cette séance.</p>
            )}
            {list.map((report) => {
              const state = downloads[keyOf(report)];
              if (!state || state.status === "loading") return null;
              const part = multiSegment ? ` (${SPORT_LABELS[report.sport].toLowerCase()})` : "";
              if (state.status === "error") {
                return (
                  <Notice key={keyOf(report)} tone="error" className="mt-2">
                    <p>
                      {info.name}
                      {part} : {state.message}
                    </p>
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => download(report)}>
                      <RotateCcw aria-hidden />
                      Réessayer
                    </Button>
                  </Notice>
                );
              }
              const note = historyNote(state.history);
              return (
                <Notice key={keyOf(report)} tone="success" className="mt-2">
                  <p>
                    Fichier téléchargé{part} : <span className="font-semibold">{state.fileName}</span>. Suivez la procédure d’import ci-dessous.
                  </p>
                  {note ? <p className="mt-1 text-[12.5px] text-ink-soft">{note}</p> : null}
                </Notice>
              );
            })}
            {list.some((r) => r.ok) ? <Procedure info={info} /> : null}
          </li>
        ))}
        {[WAHOO, SUUNTO].map((info) => (
          <li key={info.id} className="p-3" data-export-provider={info.id}>
            <p className="text-[14px] font-semibold text-ink">
              {info.name} <span className="font-normal text-muted">· envoi direct non configuré</span>
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{info.capabilities.planned.detail}</p>
            <details
              className="mt-2"
              onToggle={info.id === "suunto" ? (event) => event.currentTarget.open && setSuuntoShown(true) : undefined}
            >
              <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">
                {info.id === "suunto" ? `Recopier dans l’appli Suunto (${suunto.segments.reduce((n, s) => n + s.stepCount, 0)} étapes)` : "En attendant : méthode manuelle"}
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-snug text-ink-soft">
                {info.procedure.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {info.id === "suunto" && suuntoShown ? <SuuntoSteps plan={suunto} dateLabel={dateLabel} /> : null}
              <p className="mt-3 text-[12px] font-semibold text-ink-soft">Pour un envoi automatique, il faudrait :</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-snug text-muted">
                {info.prerequisites.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </details>
          </li>
        ))}
        <li className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] leading-snug text-ink-soft">Fiche texte de la séance, à recopier dans une application sans import de fichier.</p>
            <Button size="sm" variant="ghost" onClick={copySheet}>
              {copied === "ok" ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
              {copied === "ok" ? "Fiche copiée" : "Copier la fiche"}
            </Button>
          </div>
          {copied === "error" ? <p className="mt-1 text-[12.5px] text-danger">Copie refusée par le navigateur : sélectionnez le texte ci-dessous.</p> : null}
          <details className="mt-1" open={copied === "error" || undefined} onToggle={(event) => setSheetOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">Afficher la fiche</summary>
            {sheetOpen || copied === "error" ? (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[10px] bg-surface-2 p-2.5 font-sans text-[12.5px] leading-relaxed text-ink-soft">{sheet}</pre>
            ) : null}
          </details>
        </li>
      </ul>

      {history === null ? (
        <p className="mt-2 text-[12.5px] text-muted">L’historique des exports sera disponible après la mise à jour de la base de données du site.</p>
      ) : history.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-soft hover:text-ink">
            Exports précédents <span className="figure text-muted">({history.length})</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((entry) => (
              <li key={entry.id} className="text-[12.5px] leading-snug text-ink-soft">
                <span className="font-semibold text-ink">
                  {FILE_PROVIDERS[entry.provider].name}
                  {multiSegment ? ` · partie ${entry.segment_index + 1}` : ""}
                </span>{" "}
                — {stamp(entry.created_at)}, par {entry.requested_by_name}
                {entry.status === "failed" ? (
                  <span className="block text-danger">Échec : {entry.error}</span>
                ) : entry.session_version < version ? (
                  <span className="block text-warning">Séance modifiée depuis ce téléchargement : téléchargez-la de nouveau.</span>
                ) : entry.losses ? (
                  <span className="block text-muted">
                    {entry.losses} approximation{entry.losses > 1 ? "s" : ""} signalée{entry.losses > 1 ? "s" : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
