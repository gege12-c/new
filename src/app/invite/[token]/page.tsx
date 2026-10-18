import type { Metadata } from "next";
import { Suspense } from "react";
import { Brand } from "@/components/brand";
import { AcceptInvitationForm } from "@/components/invite/accept-form";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/feedback";
import { getSession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <Brand className="mb-8" />
      <main className="w-full max-w-sm rounded-lg border border-line bg-surface p-6">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Invitation params={params} />
        </Suspense>
      </main>
    </div>
  );
}

const STATUS_MESSAGES: Record<string, string> = {
  used: "Cette invitation a déjà été utilisée.",
  expired: "Cette invitation a expiré. Demandez un nouveau lien à votre coach.",
  revoked: "Cette invitation a été annulée par le coach.",
};

async function Invitation({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data, error }, session] = await Promise.all([
    supabase.rpc("get_invitation_preview", { p_token: token }),
    getSession(),
  ]);
  if (error) {
    return (
      <>
        <h1 className="text-[22px] font-semibold">Vérification impossible</h1>
        <p className="mt-2 text-[15px] text-muted">L’invitation n’a pas pu être vérifiée pour le moment. Réessayez dans quelques instants.</p>
      </>
    );
  }
  const invitation = data?.[0];

  if (!invitation) {
    return (
      <>
        <h1 className="text-[22px] font-semibold">Invitation introuvable</h1>
        <p className="mt-2 text-[15px] text-muted">Vérifiez que le lien a été copié en entier, ou demandez-en un nouveau à votre coach.</p>
      </>
    );
  }

  if (invitation.status !== "valid") {
    return (
      <>
        <h1 className="text-[22px] font-semibold">Invitation de {invitation.coach_name}</h1>
        <Notice tone="warning" className="mt-4">
          {STATUS_MESSAGES[invitation.status] ?? "Cette invitation n'est plus valable."}
        </Notice>
      </>
    );
  }

  const next = `/invite/${token}`;
  return (
    <>
      <h1 className="text-[22px] font-semibold">{invitation.coach_name} vous invite</h1>
      <p className="mt-2 text-[15px] text-muted">
        En acceptant, votre coach pourra voir votre profil sportif et planifier vos séances. Vous pourrez régler ses permissions ou
        retirer son accès à tout moment.
      </p>
      {invitation.email_bound ? (
        <p className="mt-2 text-sm text-muted">Cette invitation est réservée à l&apos;adresse email choisie par votre coach.</p>
      ) : null}
      <div className="mt-6">
        {session ? (
          <AcceptInvitationForm token={token} coachName={invitation.coach_name} />
        ) : (
          <div className="grid gap-2">
            <ButtonLink href={`/signup?next=${encodeURIComponent(next)}`}>Créer mon compte</ButtonLink>
            <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} variant="secondary">
              J&apos;ai déjà un compte
            </ButtonLink>
          </div>
        )}
      </div>
    </>
  );
}
