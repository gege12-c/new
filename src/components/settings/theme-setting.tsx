"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { readThemeChoice, saveThemeChoice, THEME_EVENT, THEME_KEY, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "auto", label: "Comme l’appareil", icon: Monitor },
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
];

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Thème de l'application sur cet appareil : celui de l'appareil, ou clair, ou sombre. */
export function ThemeSetting() {
  // Côté serveur : « comme l'appareil » ; le vrai choix est lu dès l'hydratation.
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => "auto" as const);
  return (
    <fieldset>
      <legend className="sr-only">Thème</legend>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const on = choice === value;
          return (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border px-2 py-3 text-center text-[13.5px] transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ink/20",
                on ? "border-ink bg-surface-2 font-semibold text-ink" : "border-line-strong text-ink-soft hover:border-ink/40",
              )}
            >
              <input type="radio" name="theme" value={value} checked={on} onChange={() => saveThemeChoice(value)} className="sr-only" />
              <Icon className="size-5" aria-hidden />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
