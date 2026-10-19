import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

/** Page d'état (introuvable, erreur) : la marque, ce qui s'est passé et quoi faire. */
export function StatusPage({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-5 py-8 sm:px-10">
      <Brand href="/home" />
      <main id="contenu" className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center py-10">
        <h1 className="display text-[32px] leading-tight">{title}</h1>
        <div className="mt-3 space-y-2 text-[15px] text-ink-soft">{children}</div>
        <div className="mt-6 flex flex-wrap gap-3">{actions}</div>
      </main>
    </div>
  );
}

/** Identifiant d'une erreur serveur (relié aux journaux), quand Next.js en fournit un. */
export function errorDigest(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest ? digest : null;
}
