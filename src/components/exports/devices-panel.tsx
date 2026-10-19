import { ChevronDown } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { CASE_LABELS, CONNECTORS, type CapabilityStatus, type ExportCase } from "@/lib/export/providers";
import { cn } from "@/lib/utils";

const STATUS: Record<CapabilityStatus, { label: string; tone: string }> = {
  available: { label: "disponible", tone: "bg-success-soft text-success" },
  manual: { label: "manuel", tone: "bg-surface-3 text-ink" },
  not_configured: { label: "non configuré", tone: "bg-warning-soft text-warning" },
  unsupported: { label: "impossible", tone: "bg-surface-3 text-muted" },
};

const CASES: ExportCase[] = ["planned", "download", "auto", "realized"];
const SHORT: Record<ExportCase, string> = { planned: "Séance", download: "Fichier", auto: "Auto", realized: "Activité" };

/** Capacités réelles de chaque fournisseur, telles qu'elles fonctionnent aujourd'hui. */
export function DevicesPanel() {
  return (
    <Panel
      id="appareils"
      title="Appareils et applications"
      description="Ce que TriCoach sait faire avec chaque appareil aujourd’hui. Les séances s’exportent depuis leur fiche, dans le calendrier."
    >
      <ul className="divide-y divide-line">
        {CONNECTORS.map((connector) => (
          <li key={connector.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-[5.5rem] items-center gap-1.5 text-[15px] font-semibold text-ink">
                  <ChevronDown aria-hidden className="size-4 -rotate-90 text-muted transition-transform group-open:rotate-0" />
                  {connector.name}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {CASES.map((c) => {
                    const status = STATUS[connector.capabilities[c].status];
                    return (
                      <span key={c} title={CASE_LABELS[c]} className={cn("rounded-[6px] px-1.5 py-[2px] text-[11.5px] font-medium", status.tone)}>
                        {SHORT[c]} : {status.label}
                      </span>
                    );
                  })}
                </span>
              </summary>
              <dl className="grid gap-2 pb-3 sm:grid-cols-2">
                {CASES.map((c) => {
                  const capability = connector.capabilities[c];
                  const status = STATUS[capability.status];
                  return (
                    <div key={c} className="rounded-[10px] bg-surface-2 px-3 py-2">
                      <dt className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-ink-soft">
                        {CASE_LABELS[c]}
                        <span className={cn("shrink-0 rounded-[6px] px-1.5 py-[2px] text-[11.5px]", status.tone)}>{status.label}</span>
                      </dt>
                      <dd className="mt-1 text-[12.5px] leading-snug text-muted">{capability.detail}</dd>
                    </div>
                  );
                })}
              </dl>
              <p className="pb-3 text-[12px] text-muted">
                Sources officielles :{" "}
                {connector.sources.map((s, i) => (
                  <span key={s.url}>
                    {i ? ", " : null}
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
                      {s.label}
                    </a>
                  </span>
                ))}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
