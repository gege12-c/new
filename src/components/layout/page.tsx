import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Zone de contenu d’une page de l’espace connecté. `wide` pour les calendriers et l’éditeur. */
export function PageContainer({ children, wide = false, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <main
      id="contenu"
      tabIndex={-1}
      className={cn(
        "mx-auto w-full px-4 pb-28 pt-6 outline-none sm:px-6 lg:pb-14 lg:pt-9",
        wide ? "max-w-[1600px] lg:px-8" : "max-w-[1080px] lg:px-10",
        className,
      )}
    >
      {children}
    </main>
  );
}
