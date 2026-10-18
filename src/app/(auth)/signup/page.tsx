import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/feedback";
import { safeNextPath } from "@/lib/utils";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-[22px] font-semibold">Créer un compte</h1>
      <p className="mt-1 text-sm text-muted">Un compte sert à la fois à vous entraîner et, si vous le souhaitez, à coacher.</p>
      <Suspense fallback={<Skeleton className="mt-6 h-80" />}>
        <SignupContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SignupContent({ searchParams }: Pick<PageProps<"/signup">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const invited = next.startsWith("/invite/");
  return (
    <>
      <SignupForm next={next} invited={invited} />
      <p className="mt-6 text-sm text-muted">
        Déjà inscrit ?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-accent underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
