import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="display text-[32px]">Mot de passe oublié</h1>
      <p className="mt-2 text-[15px] text-muted">Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-[14px]">
        <Link href="/login" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
