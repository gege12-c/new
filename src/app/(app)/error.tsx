"use client";

import { useEffect } from "react";
import { errorDigest } from "@/components/layout/status-page";
import { Button, ButtonLink } from "@/components/ui/button";

/** Erreur imprévue dans une page de l'espace connecté : la navigation reste disponible autour. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="contenu" tabIndex={-1} className="mx-auto w-full max-w-[640px] px-4 pb-28 pt-10 outline-none sm:px-6 lg:pt-16">
      <title>Erreur – TriCoach</title>
      <h1 className="display text-[30px] leading-tight">Cette page n’a pas pu s’afficher</h1>
      <p className="mt-3 text-[15px] text-ink-soft">
        Vos données enregistrées ne sont pas touchées. Réessayez dans un instant ; si le problème continue, notez le code ci-dessous pour l’administrateur du
        site.
      </p>
      {digest ? <p className="mt-2 text-[13px] text-muted">Code : {digest}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Réessayer</Button>
        <ButtonLink href="/home" variant="secondary">
          Retour à l’accueil
        </ButtonLink>
      </div>
    </main>
  );
}
