import { ArrowLeft, Flag } from "lucide-react";
import Link from "next/link";
import { PriorityBadge } from "@/components/sport";
import { daysBetween, formatDayMonthLong } from "@/lib/planning/dates";
import { THRESHOLD_DEFS, currentThresholds, formatThresholdValue, type ThresholdRow } from "@/lib/thresholds";
import { cn, initials } from "@/lib/utils";

const KEY_THRESHOLDS = ["bike.ftp_w", "run.threshold_pace_s_per_km", "swim.css_s_per_100m"] as const;
const SHORT_LABELS: Record<string, string> = {
  "bike.ftp_w": "FTP",
  "run.threshold_pace_s_per_km": "Allure seuil",
  "swim.css_s_per_100m": "CSS",
};

/** En-tête de la fiche athlète côté coach : identité, objectif, prochaine course, seuils clés, onglets. */
export function AthleteHeader({
  athleteId,
  name,
  goal,
  thresholds,
  nextEvent,
  today,
  active,
  readOnly,
}: {
  athleteId: string;
  name: string;
  goal: string | null;
  thresholds: ThresholdRow[];
  nextEvent: { name: string; event_date: string; priority: string } | null;
  today: string;
  active: "calendar" | "profile";
  readOnly: boolean;
}) {
  const current = currentThresholds(thresholds, today);
  const days = nextEvent ? daysBetween(today, nextEvent.event_date) : null;
  const tabs = [
    { key: "calendar", label: "Calendrier", href: `/coach/athletes/${athleteId}` },
    { key: "profile", label: "Profil et seuils", href: `/coach/athletes/${athleteId}/profile` },
  ] as const;
  return (
    <header className="mb-5">
      <Link href="/coach" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Athlètes
      </Link>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span aria-hidden className="figure flex size-12 shrink-0 items-center justify-center rounded-full bg-ink text-[16px] text-canvas">
            {initials(name)}
          </span>
          <div className="min-w-0">
            <h1 className="display truncate text-[28px] sm:text-[32px]">{name}</h1>
            <p className="truncate text-[14px] text-muted">{goal ?? "Objectif non renseigné"}</p>
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:ml-auto">
          {KEY_THRESHOLDS.map((key) => {
            const row = current.get(key);
            const def = THRESHOLD_DEFS.find((d) => d.key === key);
            return (
              <div key={key}>
                <dt className="text-[11px] font-semibold text-muted">{SHORT_LABELS[key]}</dt>
                <dd className={cn("figure text-[17px] leading-tight", row ? "text-ink" : "text-muted")}>
                  {row && def ? formatThresholdValue(def, Number(row.value)) : "—"}
                </dd>
              </div>
            );
          })}
          {nextEvent && days !== null ? (
            <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-1.5">
              <Flag className="size-4 text-ink-soft" aria-hidden />
              <div>
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                  {nextEvent.name}
                  <PriorityBadge priority={nextEvent.priority} />
                </dt>
                <dd className="figure text-[15px] leading-tight text-ink">
                  J−{days} <span className="text-[12px] font-medium text-muted">{formatDayMonthLong(nextEvent.event_date)}</span>
                </dd>
              </div>
            </div>
          ) : null}
        </dl>
      </div>
      <nav aria-label="Sections de la fiche" className="mt-5 flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[14px] font-semibold transition-colors",
              tab.key === active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
        {readOnly ? <span className="ml-auto self-center text-[12px] font-medium text-warning">Lecture seule</span> : null}
      </nav>
    </header>
  );
}
