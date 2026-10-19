"use client";

import { useEffect } from "react";
import { errorDigest, StatusPage } from "@/components/layout/status-page";
import { Button, ButtonLink } from "@/components/ui/button";

/** Erreur imprévue hors de l'espace connecté (connexion, inscription, invitation…). */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage
      title="Cette page n’a pas pu s’afficher"
      actions={
        <>
          <Button onClick={() => retry()}>Réessayer</Button>
          <ButtonLink href="/home" variant="secondary">
            Retour à l’accueil
          </ButtonLink>
        </>
      }
    >
      <title>Erreur – TriCoach</title>
      <p>Vos données enregistrées ne sont pas touchées. Réessayez dans un instant ; si le problème continue, notez le code ci-dessous pour l’administrateur du site.</p>
      {digest ? <p className="text-[13px] text-muted">Code : {digest}</p> : null}
    </StatusPage>
  );
}
