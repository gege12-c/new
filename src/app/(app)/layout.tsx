import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { NavLinks, type NavKey } from "@/components/app-nav";
import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/feedback";
import { getProfile } from "@/lib/auth/dal";
import { signOut } from "../(auth)/actions";

/** Coquille de l'espace connecté : barre latérale sur ordinateur, barre basse sur mobile. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:flex-col lg:px-3 lg:py-5">
        <Brand href="/home" className="px-3" />
        <nav aria-label="Navigation principale" className="mt-8 flex-1">
          <Suspense fallback={<NavFallback />}>
            <SidebarNav />
          </Suspense>
        </nav>
        <Suspense fallback={<Skeleton className="mx-3 h-10" />}>
          <AccountBlock />
        </Suspense>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
          <Brand href="/home" />
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">{children}</main>
      </div>

      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <Suspense fallback={<div className="h-14" />}>
          <BottomNav />
        </Suspense>
      </nav>
    </div>
  );
}

async function navKeys(): Promise<NavKey[]> {
  const profile = await getProfile();
  return profile.is_coach ? ["coach", "athlete", "profile", "settings"] : ["athlete", "profile", "settings"];
}

async function SidebarNav() {
  return <NavLinks keys={await navKeys()} variant="sidebar" />;
}

async function BottomNav() {
  return <NavLinks keys={await navKeys()} variant="bottom" />;
}

async function AccountBlock() {
  const profile = await getProfile();
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-3 pt-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{profile.display_name}</p>
        <p className="text-xs text-muted">{profile.is_coach ? "Coach et athlète" : "Athlète"}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Se déconnecter"
          title="Se déconnecter"
        >
          <LogOut className="size-[18px]" aria-hidden />
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
