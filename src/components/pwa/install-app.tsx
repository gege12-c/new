"use client";

import { Download, Share, Smartphone, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Évènement d'installation de Chrome et Edge (Android, ordinateur). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "tricoach:install-card-dismissed";
const subscribeNothing = () => () => {};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Proposition d'installation : bouton natif quand le navigateur l'offre, sinon la marche à suivre. */
function useInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const standalone = useSyncExternalStore(subscribeNothing, isStandalone, () => false);
  const ios = useSyncExternalStore(subscribeNothing, isIos, () => false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPrompt(null);
  }

  return { canPrompt: Boolean(prompt), install, installed: installed || standalone, ios };
}

/** Panneau des réglages : état de l'installation et marche à suivre pour chaque téléphone. */
export function InstallPanelBody() {
  const { canPrompt, install, installed, ios } = useInstall();
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-ink-soft">
      {installed ? (
        <p className="font-medium text-success">TriCoach est installé sur cet appareil.</p>
      ) : canPrompt ? (
        <Button size="sm" onClick={install}>
          <Download aria-hidden />
          Installer TriCoach
        </Button>
      ) : null}
      <ul className="space-y-2">
        <li className={cn(ios && "font-medium text-ink")}>
          <span className="font-semibold text-ink">iPhone et iPad</span> : dans Safari, touchez <Share aria-label="Partager" className="inline size-4 align-[-3px]" /> Partager, puis « Sur l’écran d’accueil ».
        </li>
        <li>
          <span className="font-semibold text-ink">Android</span> : dans Chrome, ouvrez le menu ⋮ puis « Installer l’application » (ou « Ajouter à l’écran d’accueil »).
        </li>
        <li>
          <span className="font-semibold text-ink">Ordinateur</span> : Chrome et Edge proposent l’installation dans la barre d’adresse.
        </li>
      </ul>
      <p className="text-[13px] text-muted">L’application installée s’ouvre en plein écran, sans barre d’adresse ; elle affiche toujours vos données à jour (rien n’est conservé sur l’appareil).</p>
    </div>
  );
}

/** Carte discrète de l'accueil, sur téléphone seulement, tant qu'elle n'est ni installée ni écartée. */
export function InstallCard() {
  const { canPrompt, install, installed, ios } = useInstall();
  const storedDismissal = useSyncExternalStore(subscribeNothing, readDismissed, () => true);
  const [dismissed, setDismissed] = useState(false);
  if (installed || dismissed || storedDismissal || (!canPrompt && !ios)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Stockage indisponible : la carte reviendra à la prochaine visite.
    }
  };

  return (
    <aside aria-label="Installer l’application" className="flex items-start gap-3 rounded-[14px] border border-line bg-surface p-3.5 md:hidden">
      <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1 text-[14px] leading-snug">
        <p className="font-semibold text-ink">TriCoach sur votre écran d’accueil</p>
        {canPrompt ? (
          <Button size="sm" className="mt-2" onClick={install}>
            <Download aria-hidden />
            Installer
          </Button>
        ) : (
          <p className="mt-1 text-ink-soft">
            Dans Safari, touchez <Share aria-label="Partager" className="inline size-4 align-[-3px]" /> Partager, puis « Sur l’écran d’accueil ».
          </p>
        )}
      </div>
      <button type="button" onClick={dismiss} className="-m-1 rounded-[8px] p-1 text-muted hover:text-ink" aria-label="Masquer">
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  );
}
