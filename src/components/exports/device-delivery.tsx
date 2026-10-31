import { AlertTriangle, CheckCircle2, Clock, Link2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import type { DeviceDelivery, DevicePartState } from "@/lib/data/devices";
import type { CompatibilityIssue } from "@/lib/export/types";
import { formatFullDate } from "@/lib/planning/dates";
import { SPORT_LABELS, type SegmentSport } from "@/lib/workout/schema";
import { cn } from "@/lib/utils";

/** Ce que la montre recevra de chaque partie : conversion possible, et ce qu'elle ne suivra pas. */
export interface DeviceReport {
  segmentIndex: number;
  sport: SegmentSport;
  ok: boolean;
  issues: CompatibilityIssue[];
}

export interface WatchAuto {
  viewer: "athlete" | "coach";
  /** null tant que la base du site n'est pas à jour. */
  deliveries: DeviceDelivery[] | null;
  reports: Partial<Record<DeviceDelivery["provider"], DeviceReport[]>>;
}

export const DELIVERY_TITLES: Record<DeviceDelivery["provider"], string> = { intervals: "Par intervals.icu", suunto: "Suunto en direct" };

function partText(provider: DeviceDelivery["provider"], part: DevicePartState, viewer: "athlete" | "coach", timeZone: string): { tone: "ok" | "wait" | "error"; text: string } {
  const own = viewer === "athlete";
  switch (part.state) {
    case "sent": {
      const at = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(part.sentAt));
      return provider === "intervals"
        ? { tone: "ok", text: `Déposée dans ${own ? "votre" : "son"} calendrier intervals.icu le ${at} : intervals.icu la transmet à la montre dans la semaine qui précède la séance.` }
        : { tone: "ok", text: `Envoyée sur ${own ? "votre" : "son"} compte Suunto le ${at} : la montre la reçoit à la prochaine synchronisation de l’application Suunto.` };
    }
    case "updating":
      return { tone: "wait", text: "Séance modifiée : mise à jour en cours." };
    case "pending":
      return { tone: "wait", text: "Envoi en cours." };
    case "failed":
      return { tone: "error", text: `Non envoyée : ${part.error}` };
    case "later":
      return { tone: "wait", text: `Partira le ${formatFullDate(part.from)}.` };
    case "past":
      return { tone: "wait", text: "Séance passée." };
    case "draft":
      return { tone: "wait", text: "Brouillon : la séance part une fois publiée." };
  }
}

const ICONS = { ok: CheckCircle2, wait: Clock, error: AlertTriangle } as const;
const TONES = { ok: "text-success", wait: "text-muted", error: "text-warning" } as const;

/** État de l'envoi automatique de la séance vers la montre de l'athlète, compte par compte et partie par partie. */
export function DeviceDeliveryList({ delivery, auto, timeZone }: { delivery: DeviceDelivery; auto: WatchAuto; timeZone: string }) {
  const own = auto.viewer === "athlete";
  if (delivery.connection === "reauth_required") {
    const text =
      delivery.provider === "intervals"
        ? own
          ? "intervals.icu refuse la clé enregistrée : collez votre nouvelle clé dans votre profil."
          : "L’athlète doit renouveler sa clé intervals.icu : ses séances ne partent plus."
        : own
          ? "Suunto a refusé l’accès de TriCoach : reconnectez votre compte dans votre profil."
          : "L’athlète doit reconnecter son compte Suunto : ses séances ne partent plus.";
    return <p className="mt-1 text-[13px] leading-snug text-warning">{text}</p>;
  }
  const multi = delivery.parts.length > 1;
  const reports = auto.reports[delivery.provider] ?? [];
  return (
    <ul className="mt-1 space-y-1.5" data-device-delivery={delivery.provider}>
      {delivery.parts.map(({ segmentIndex, part }) => {
        const { tone, text } = partText(delivery.provider, part, auto.viewer, timeZone);
        const Icon = ICONS[tone];
        const sport = reports.find((r) => r.segmentIndex === segmentIndex)?.sport;
        return (
          <li key={segmentIndex} className="flex gap-2 text-[13px] leading-snug">
            <Icon aria-hidden className={cn("mt-[2px] size-3.5 shrink-0", TONES[tone])} />
            <span className={tone === "error" ? "text-ink" : "text-ink-soft"}>
              {multi && sport ? <span className="font-medium text-ink">{SPORT_LABELS[sport]} : </span> : null}
              {text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Aucun compte de montre relié : comment faire (athlète), ou simple constat (coach). */
export function NoWatchLinked({ viewer }: { viewer: "athlete" | "coach" }) {
  return viewer === "athlete" ? (
    <div className="mt-2 space-y-2">
      <p className="text-[13px] leading-snug text-ink-soft">
        Reliez votre montre (Suunto, Garmin ou COROS) une fois, par intervals.icu : vos séances publiées y partiront ensuite seules.
      </p>
      <a href="/athlete/profile#montre-auto" className={buttonClasses("secondary", "sm")}>
        <Link2 aria-hidden />
        Relier ma montre
      </a>
    </div>
  ) : (
    <p className="mt-2 text-[13px] text-muted">L’athlète n’a pas relié de montre.</p>
  );
}
