import type { Metadata } from "next";
import { StatusPage } from "@/components/layout/status-page";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page introuvable" };

/** Adresse inconnue, ou séance, athlète ou modèle absent ou inaccessible (`notFound()`). */
export default function NotFound() {
  return (
    <StatusPage title="Page introuvable" actions={<ButtonLink href="/home">Retour à l’accueil</ButtonLink>}>
      <p>Cette adresse ne correspond à aucune page, ou ce qu’elle montrait n’existe plus ou ne vous est pas accessible.</p>
    </StatusPage>
  );
}
