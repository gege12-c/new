/** Traduit les erreurs de la base et de l’authentification en messages compréhensibles. */

const DB_MESSAGES: Record<string, string> = {
  not_authenticated: "Votre session a expiré : reconnectez-vous.",
  not_a_coach: "Activez le mode coach dans vos réglages pour inviter des athlètes.",
  invalid_validity: "Durée de validité invalide.",
  too_many_pending_invitations: "Vous avez déjà 20 invitations en attente : annulez-en avant d’en créer d’autres.",
  invalid_invitation: "Ce lien d’invitation n’est pas valide. Vérifiez qu’il a été copié en entier.",
  invitation_revoked: "Cette invitation a été annulée par le coach.",
  invitation_used: "Cette invitation a déjà été utilisée.",
  invitation_expired: "Cette invitation a expiré : demandez-en une nouvelle à votre coach.",
  cannot_accept_own_invitation: "Vous ne pouvez pas accepter votre propre invitation.",
  invitation_email_mismatch:
    "Cette invitation est réservée à une autre adresse email. Connectez-vous avec l’adresse invitée, une fois confirmée.",
  invitation_not_revocable: "Cette invitation a déjà été utilisée ou annulée.",
  link_not_found: "Cette relation n’existe plus.",
  invalid_permissions: "Permissions invalides.",
  invalid_timezone: "Fuseau horaire inconnu.",
  athlete_can_only_reschedule: "Vous pouvez déplacer cette séance, mais seul votre coach peut en modifier le contenu.",
  immutable_field: "Ce champ ne peut pas être modifié.",
  session_not_found: "Cette séance n’existe plus ou ne vous est plus accessible.",
  session_not_editable: "Vous n’avez pas le droit de modifier cette séance.",
  session_is_draft: "Cette séance est un brouillon : enregistrez-la directement.",
  session_conflict: "Cette séance a été modifiée entre-temps par quelqu’un d’autre.",
  draft_not_found: "Aucune modification en attente pour cette séance.",
  invalid_session_payload: "Données de séance invalides.",
  week_must_start_monday: "Une semaine commence un lundi.",
  same_week: "Choisissez une autre semaine que celle copiée.",
};

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email ou mot de passe incorrect.",
  email_not_confirmed: "Confirmez d’abord votre adresse : le lien vous a été envoyé par email.",
  user_already_exists: "Un compte existe déjà avec cette adresse. Connectez-vous.",
  email_exists: "Un compte existe déjà avec cette adresse. Connectez-vous.",
  weak_password: "Mot de passe trop faible : 8 caractères minimum, mélangez lettres et chiffres.",
  over_email_send_rate_limit: "Trop d’emails envoyés : réessayez dans quelques minutes.",
  over_request_rate_limit: "Trop de tentatives : réessayez dans quelques minutes.",
  signup_disabled: "Les inscriptions sont désactivées pour le moment.",
  same_password: "Choisissez un mot de passe différent de l’actuel.",
  email_address_not_authorized:
    "L’email n’a pas pu être envoyé : l’envoi d’emails du site n’est pas encore configuré pour cette adresse.",
};

/** Échec d’envoi d’email côté Supabase (service d’envoi non configuré ou limite atteinte). */
const EMAIL_SENDING_FAILED = /error sending (confirmation|recovery|magic link|invite) email/i;

type ErrorLike = { message?: string; code?: string | number } | null | undefined;

export function friendlyError(error: ErrorLike, fallback = "L’opération n’a pas abouti. Réessayez."): string {
  if (!error) return fallback;
  const message = error.message ?? "";
  const code = String(error.code ?? "");
  for (const [key, text] of Object.entries(DB_MESSAGES)) if (message.includes(key)) return text;
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (EMAIL_SENDING_FAILED.test(message)) return AUTH_MESSAGES.email_address_not_authorized;
  if (code === "23505") return "Cette valeur existe déjà.";
  if (code === "23514") return "Valeur hors des limites autorisées.";
  if (code === "42501") return "Vous n’avez pas les droits pour cette action.";
  return fallback;
}
