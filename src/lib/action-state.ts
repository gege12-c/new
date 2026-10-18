/** État renvoyé par les Server Actions aux formulaires (useActionState). */
export type ActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Données à afficher après succès (lien d’invitation, etc.). */
  data?: Record<string, string>;
};

export const idle: ActionState = { status: "idle" };
export const fail = (message: string): ActionState => ({ status: "error", message });
export const done = (message?: string, data?: Record<string, string>): ActionState => ({ status: "success", message, data });

/** Premier message d’erreur d’une validation Zod. */
export function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Formulaire incomplet.";
}
