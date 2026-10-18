import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { safeNextPath } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

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
  const error = read("error");
  const confirmed = read("confirmed") === "1";

  return (
    <>
      {confirmed ? (
        <Notice tone="success" className="mt-4">
          Adresse confirmée. Connectez-vous pour continuer.
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
