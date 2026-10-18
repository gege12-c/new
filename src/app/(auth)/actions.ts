"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, firstIssue, type ActionState } from "@/lib/action-state";
import { friendlyError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

const email = z.email("Adresse email invalide.").max(254);

const signInSchema = z.object({
  email,
  password: z.string().min(1, "Saisissez votre mot de passe."),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  });
  if (error) return fail(friendlyError(error, "Connexion impossible pour le moment."));
  redirect(safeNextPath(parsed.data.next));
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Indiquez votre nom.").max(80, "80 caractères maximum."),
  email,
  password: z.string().min(8, "Mot de passe : 8 caractères minimum.").max(72, "Mot de passe : 72 caractères maximum."),
  coach: z.literal("on").optional(),
  timezone: z.string().max(64).optional(),
  next: z.string().optional(),
});

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const next = safeNextPath(parsed.data.next);
  const site = await getSiteUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    options: {
      // Le trigger handle_new_user crée le profil à partir de ces métadonnées.
      data: {
        display_name: parsed.data.name,
        is_coach: parsed.data.coach === "on",
        timezone: parsed.data.timezone || "Europe/Paris",
      },
      emailRedirectTo: `${site}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return fail(friendlyError(error, "Inscription impossible pour le moment."));

  // Confirmation d’email désactivée : la session existe déjà.
  if (data.session) redirect(next);

  return {
    status: "success",
    message: `Un email de confirmation a été envoyé à ${parsed.data.email}. Ouvrez le lien qu’il contient pour activer votre compte.`,
  };
}

const resetRequestSchema = z.object({ email });

/** Envoie le lien de réinitialisation. La réponse est identique que le compte existe ou non. */
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const supabase = await createClient();
  const site = await getSiteUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email.toLowerCase(), {
    redirectTo: `${site}/auth/confirm?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error && error.code !== "user_not_found") return fail(friendlyError(error, "Envoi impossible pour le moment."));
  return {
    status: "success",
    message: "Si un compte existe pour cette adresse, un lien de réinitialisation vient d’être envoyé.",
  };
}

const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Mot de passe : 8 caractères minimum.").max(72, "Mot de passe : 72 caractères maximum."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Les deux mots de passe diffèrent.", path: ["confirm"] });

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return fail("Lien expiré : demandez un nouveau lien de réinitialisation.");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(friendlyError(error, "Le mot de passe n’a pas pu être changé."));
  redirect("/home");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
