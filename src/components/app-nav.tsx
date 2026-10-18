"use client";

import { CalendarDays, Gauge, LibraryBig, Settings, Sunrise, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavKey = "today" | "calendar" | "profile" | "athletes" | "library" | "settings";

const ITEMS: Record<NavKey, { href: string; label: string; short: string; icon: LucideIcon }> = {
  athletes: { href: "/coach", label: "Athlètes", short: "Athlètes", icon: UsersRound },
  library: { href: "/coach/library", label: "Bibliothèque", short: "Modèles", icon: LibraryBig },
  today: { href: "/athlete", label: "Aujourd’hui", short: "Aujourd’hui", icon: Sunrise },
  calendar: { href: "/athlete/calendar", label: "Calendrier", short: "Calendrier", icon: CalendarDays },
  profile: { href: "/athlete/profile", label: "Profil sportif", short: "Profil", icon: Gauge },
  settings: { href: "/settings", label: "Réglages", short: "Réglages", icon: Settings },
};

function isActive(pathname: string, key: NavKey) {
  const { href } = ITEMS[key];
  if (key === "today") return pathname === "/athlete";
  if (key === "athletes") return pathname === "/coach" || pathname.startsWith("/coach/athletes");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface NavGroup {
  label?: string;
  keys: NavKey[];
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      {groups.map((group, index) => (
        <div key={group.label ?? index}>
          {group.label ? <p className="mb-1.5 px-3 text-[12px] font-medium text-muted">{group.label}</p> : null}
          <ul className="space-y-0.5">
            {group.keys.map((key) => {
              const { href, label, icon: Icon } = ITEMS[key];
              const active = isActive(pathname, key);
              return (
                <li key={key}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-3 rounded-[8px] px-3 text-[14px] transition-colors",
                      active ? "bg-surface-2 font-semibold text-ink" : "text-ink-soft hover:bg-surface-2/70 hover:text-ink",
                    )}
                  >
                    <Icon className={cn("size-[18px]", active ? "text-ink" : "text-muted")} strokeWidth={active ? 2.3 : 2} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function BottomNav({ keys }: { keys: NavKey[] }) {
  const pathname = usePathname();
  return (
    <ul className="grid" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
      {keys.map((key) => {
        const { href, short, icon: Icon } = ITEMS[key];
        const active = isActive(pathname, key);
        return (
          <li key={key}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] leading-none",
                active ? "font-semibold text-ink" : "text-muted",
              )}
            >
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-surface-3")}>
                <Icon className="size-5" strokeWidth={active ? 2.3 : 2} aria-hidden />
              </span>
              {short}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileSettingsLink() {
  const pathname = usePathname();
  const active = pathname.startsWith("/settings");
  return (
    <Link
      href="/settings"
      aria-label="Réglages"
      aria-current={active ? "page" : undefined}
      className={cn("flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-surface-2", active && "bg-surface-2 text-ink")}
    >
      <Settings className="size-5" aria-hidden />
    </Link>
  );
}
