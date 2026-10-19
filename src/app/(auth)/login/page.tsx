import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { safeNextPath } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

/** Messages affichables : un lien ne peut pas faire écrire n'importe quel texte sur cette page. */
const ERRORS: Record<string, string> = {
  link: "Lien de confirmation invalide ou expiré. Connectez-vous, ou demandez un nouveau lien.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div>
      <h1 className="display text-[32px]">Connexion</h1>
      <Suspense fallback={<Skeleton className="mt-6 h-56" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const read = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const next = safeNextPath(read("next"));
  const error = ERRORS[read("error") ?? ""];
  const confirmed = read("confirmed") === "1";
  const deleted = read("deleted");

  return (
    <>
      {confirmed ? (
        <Notice tone="success" className="mt-4">
          Adresse confirmée. Connectez-vous pour continuer.
        </Notice>
      ) : null}
      {deleted === "1" || deleted === "strava" ? (
        <Notice tone="success" className="mt-4">
          Votre compte et toutes vos données ont été supprimés.
          {deleted === "strava"
            ? " Strava n’a pas confirmé le retrait de l’accès : retirez TriCoach dans les réglages de votre compte Strava (Applications)."
            : null}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}
      <LoginForm next={next} />
      <p className="mt-6 text-[14px]">
        <Link href="/forgot-password" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Mot de passe oublié ?
        </Link>
      </p>
      <p className="mt-2 text-[14px] text-muted">
        Pas encore de compte ?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Créer un compte
        </Link>
      </p>
    </>
  );
}
