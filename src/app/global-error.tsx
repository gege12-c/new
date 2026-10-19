"use client";

import { useEffect } from "react";
import { errorDigest, StatusPage } from "@/components/layout/status-page";
import { Button } from "@/components/ui/button";
import { archivo } from "./fonts";
import "./globals.css";

/** Erreur dans la mise en page racine elle-même : document complet, styles et police compris. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="fr" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">
        <StatusPage title="TriCoach n’a pas pu s’afficher" actions={<Button onClick={() => retry()}>Réessayer</Button>}>
          <title>Erreur – TriCoach</title>
          <p>Vos données enregistrées ne sont pas touchées. Réessayez dans un instant ; si le problème continue, notez le code ci-dessous pour l’administrateur du site.</p>
          {digest ? <p className="text-[13px] text-muted">Code : {digest}</p> : null}
        </StatusPage>
      </body>
    </html>
  );
}
