import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

/** Atteinte depuis le lien reçu par email : la session ouverte par ce lien autorise le changement. */
export default function ResetPasswordPage() {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-[22px] font-semibold">Nouveau mot de passe</h1>
      <ResetPasswordForm />
    </div>
  );
}
