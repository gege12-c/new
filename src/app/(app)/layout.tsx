import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { BottomNav, MobileSettingsLink, SidebarNav, type NavGroup, type NavKey } from "@/components/app-nav";
import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/feedback";
import { getProfile } from "@/lib/auth/dal";
import { initials } from "@/lib/utils";
import { signOut } from "../(auth)/actions";

/** Coquille de l’espace connecté : barre latérale sur ordinateur, barre basse sur mobile. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[232px] lg:shrink-0 lg:flex-col lg:px-3 lg:pb-4 lg:pt-5">
        <Brand href="/home" className="px-3" />
        <nav aria-label="Navigation principale" className="mt-9 flex-1 overflow-y-auto">
          <Suspense fallback={<NavFallback />}>
            <Sidebar />
          </Suspense>
        </nav>
        <Suspense fallback={<Skeleton className="mx-2 h-12" />}>
          <AccountBlock />
        </Suspense>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur-md lg:hidden">
          <Brand href="/home" />
          <Suspense fallback={<span className="size-9" />}>
            <MobileSettingsLink />
          </Suspense>
        </header>
        {children}
      </div>

      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <Suspense fallback={<div className="h-16" />}>
          <Bottom />
        </Suspense>
      </nav>
    </div>
  );
}

async function navGroups(): Promise<NavGroup[]> {
  const profile = await getProfile();
  const training: NavKey[] = ["today", "calendar", "profile"];
  if (!profile.is_coach) return [{ keys: [...training, "settings"] }];
  return [
    { keys: ["athletes", "library"] },
    { label: "Mon entraînement", keys: training },
    { keys: ["settings"] },
  ];
}

async function Sidebar() {
  return <SidebarNav groups={await navGroups()} />;
}

async function Bottom() {
  const profile = await getProfile();
  const keys: NavKey[] = profile.is_coach ? ["athletes", "library", "today", "calendar", "profile"] : ["today", "calendar", "profile"];
  return <BottomNav keys={keys} />;
}

async function AccountBlock() {
  const profile = await getProfile();
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-2 py-2">
      <span
        aria-hidden
        className="figure flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] text-canvas"
      >
        {initials(profile.display_name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{profile.display_name}</p>
        <p className="text-[12px] text-muted">{profile.is_coach ? "Coach et athlète" : "Athlète"}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Se déconnecter"
          title="Se déconnecter"
        >
          <LogOut className="size-[17px]" aria-hidden />
        </button>
      </form>
    </div>
  );
}

function NavFallback() {
  return (
    <div className="space-y-2 px-3">
      <Skeleton className="h-8" />
      <Skeleton className="h-8" />
      <Skeleton className="h-8" />
    </div>
  );
}
