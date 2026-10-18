"use client";

import { Activity, Settings, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavKey = "athlete" | "profile" | "coach" | "settings";

const ITEMS: Record<NavKey, { href: string; label: string; short: string; icon: LucideIcon }> = {
  athlete: { href: "/athlete", label: "Mon entraînement", short: "Entraînement", icon: Activity },
  profile: { href: "/athlete/profile", label: "Profil sportif", short: "Profil", icon: UserRound },
  coach: { href: "/coach", label: "Mes athlètes", short: "Athlètes", icon: UsersRound },
  settings: { href: "/settings", label: "Réglages", short: "Réglages", icon: Settings },
};

function isActive(pathname: string, href: string) {
  if (href === "/athlete") return pathname === "/athlete";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ keys, variant }: { keys: NavKey[]; variant: "sidebar" | "bottom" }) {
  const pathname = usePathname();
  if (variant === "sidebar") {
    return (
      <ul className="space-y-0.5">
        {keys.map((key) => {
          const { href, label, icon: Icon } = ITEMS[key];
          const active = isActive(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors",
                  active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="grid" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
      {keys.map((key) => {
        const { href, short, icon: Icon } = ITEMS[key];
        const active = isActive(pathname, href);
        return (
          <li key={key}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-xs",
                active ? "font-medium text-accent" : "text-muted",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {short}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
