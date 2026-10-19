/** Démarrage du serveur : messages de validation en français pour tout le processus. */
import { installFrenchValidationMessages } from "@/lib/validation-messages";

export function register() {
  installFrenchValidationMessages();
}
