import { Panel } from "@/components/ui/panel";
import { CASE_LABELS, CONNECTORS, type CapabilityStatus, type ExportCase } from "@/lib/export/providers";
import { cn } from "@/lib/utils";

const STATUS: Record<CapabilityStatus, { label: string; tone: string }> = {
  available: { label: "Disponible", tone: "bg-success-soft text-success" },
  manual: { label: "Manuel", tone: "bg-surface-3 text-ink" },
  not_configured: { label: "Non configuré", tone: "bg-warning-soft text-warning" },
  unsupported: { label: "Impossible", tone: "bg-surface-3 text-muted" },
};

const CASES: ExportCase[] = ["planned", "download", "auto", "realized"];

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
          <li key={connector.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-[15px] font-semibold text-ink">{connector.name}</p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
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
            <p className="mt-2 text-[12px] text-muted">
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
          </li>
        ))}
      </ul>
    </Panel>
  );
}
