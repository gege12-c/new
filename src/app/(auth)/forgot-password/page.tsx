import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-[22px] font-semibold">Mot de passe oublié</h1>
      <p className="mt-1 text-sm text-muted">Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
