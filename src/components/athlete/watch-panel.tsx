import { revokeWatchDevice } from "@/app/(app)/watch-actions";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { Panel } from "@/components/ui/panel";
import { isMissingSchema, SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";
import type { ServerSupabase } from "@/lib/supabase/server";
import { WATCH_APP } from "@/lib/watch/app";
import { WatchPairForm } from "./watch-pair-form";

const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));

type Device = { created_at: string; connected_at: string | null; last_seen_at: string | null };

/** Où en est la montre : en attente de son jeton, associée, ou déjà servie. */
function deviceState(device: Device, timeZone: string): string {
  if (!device.connected_at) return "En attente de la montre : laissez l’application TriCoach ouverte, l’association se termine en quelques secondes.";
  const since = `Associée le ${when(device.connected_at, timeZone)}`;
  return device.last_seen_at ? `${since}, dernier contact le ${when(device.last_seen_at, timeZone)}` : `${since}, aucune séance demandée pour l’instant`;
}

/** Montres Garmin associées et association d'une nouvelle montre (application TriCoach, Connect IQ). */
export async function WatchPanel({ supabase, timeZone }: { supabase: ServerSupabase; timeZone: string }) {
  const { data, error } = await supabase
    .from("watch_devices")
    .select("id, device_name, created_at, connected_at, last_seen_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  const devices = data ?? [];
  if (error && !isMissingSchema(error)) throw error;

  return (
    <Panel
      id="montre"
      title="Montre Garmin"
      description="Avec l’application TriCoach sur votre montre, vos séances deviennent de vraies séances Garmin : écrans, alertes et cibles de la montre, sans câble. Toutes les 30 minutes, la montre vérifie seule si une nouvelle séance est à charger et vous la propose."
    >
      {error ? (
        <p className="text-[14px] text-muted">{SCHEMA_PENDING_MESSAGE}</p>
      ) : (
        <div className="space-y-5">
          {devices.length ? (
            <ul className="-my-2 divide-y divide-line">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-semibold">{device.device_name}</p>
                    <p className="text-[13px] text-muted">{deviceState(device, timeZone)}</p>
                  </div>
                  <form action={revokeWatchDevice}>
                    <input type="hidden" name="id" value={device.id} />
                    <ConfirmSubmit size="sm" variant="ghost" confirmMessage={`Dissocier ${device.device_name} ? Elle ne recevra plus vos séances.`}>
                      Dissocier
                    </ConfirmSubmit>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-3">
            <h3 className="text-[15px] font-semibold">{devices.length ? "Associer une autre montre" : "Associer votre montre"}</h3>
            <ol className="list-decimal space-y-1 pl-5 text-[13.5px] text-ink-soft">
              <li>
                {WATCH_APP.storeUrl ? (
                  <>
                    Installez l’application TriCoach sur votre montre depuis le{" "}
                    <a className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={WATCH_APP.storeUrl} target="_blank" rel="noreferrer">
                      Connect IQ Store
                    </a>
                    .
                  </>
                ) : (
                  <>
                    Installez l’application TriCoach sur votre montre. <span className="text-muted">{WATCH_APP.availability}</span>{" "}
                    <a className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={WATCH_APP.guideUrl} target="_blank" rel="noreferrer">
                      Guide d’installation
                    </a>
                  </>
                )}
              </li>
              <li>Ouvrez-la sur la montre : elle affiche un code de 8 caractères.</li>
              <li>Saisissez ce code ci-dessous.</li>
            </ol>
            <WatchPairForm />
          </div>

          <p className="border-t border-line pt-3 text-[12.5px] leading-snug text-muted">
            La montre ne reçoit que vos séances publiées des 7 prochains jours et vos seuils, rien d’autre. Vos séances faites reviennent par Strava ou par vos
            fichiers FIT, comme avant. Dissocier une montre coupe son accès aussitôt.
          </p>
        </div>
      )}
    </Panel>
  );
}
