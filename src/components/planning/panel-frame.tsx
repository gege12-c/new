"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Panneau de détail posé sur le calendrier, qui reste visible à gauche (ordinateur)
 * ou dessous (mobile). Échap ou la croix le referment ; le focus va au titre à l’ouverture.
 */
export function PanelFrame({ closeHref, title, children }: { closeHref: string; title: string; children: ReactNode }) {
  const router = useRouter();
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);
  return (
    <>
      <Link href={closeHref} scroll={false} aria-hidden tabIndex={-1} className="fixed inset-0 z-30 bg-night/30 backdrop-blur-[1px] lg:hidden" />
      <aside
        aria-label={title}
        className="fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col overflow-hidden rounded-t-[20px] border-t border-line bg-surface shadow-pop lg:inset-y-0 lg:left-auto lg:right-0 lg:top-0 lg:w-[460px] lg:rounded-none lg:border-l lg:border-t-0"
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong lg:hidden" />
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Fermer le détail"
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-surface/90 text-muted backdrop-blur hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </Link>
        <div ref={heading} tabIndex={-1} className="flex-1 overflow-y-auto overscroll-contain px-5 pb-28 pt-5 outline-none lg:px-6 lg:pb-10 lg:pt-6">
          {children}
        </div>
      </aside>
    </>
  );
}
