/**
 * Messages de validation par défaut, en français et compréhensibles, pour toute règle Zod écrite
 * sans message. Les messages écrits dans les schémas restent prioritaires (Zod 4 : message du
 * schéma, puis cette configuration globale, puis la langue par défaut, l'anglais).
 *
 * Installés au démarrage du serveur (`src/instrumentation.ts`) et du navigateur
 * (`src/instrumentation-client.ts`) : aucun message technique en anglais n'atteint l'utilisateur.
 */
import { config, type core } from "zod";

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const n = (value: number | bigint) => number.format(value);

const FORMATS: Record<string, string> = {
  email: "Adresse email invalide.",
  url: "Adresse web invalide.",
  date: "Date invalide.",
  datetime: "Date et heure invalides.",
  time: "Heure invalide.",
  uuid: "Identifiant invalide : rechargez la page puis réessayez.",
  guid: "Identifiant invalide : rechargez la page puis réessayez.",
};

/** Un champ absent du formulaire : la page vient d'une version précédente du site, ou a été modifiée. */
export const MISSING_FIELD = "Information manquante : rechargez la page puis réessayez.";

export const frenchErrorMap: core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return MISSING_FIELD;
      if (issue.expected === "number" || issue.expected === "int") return "Nombre attendu.";
      if (issue.expected === "date") return "Date invalide.";
      return "Valeur invalide.";
    case "too_small": {
      const count = issue.origin === "string" ? "caractères" : issue.origin === "array" || issue.origin === "set" ? "éléments" : null;
      if (count) {
        if (issue.exact) return `Exactement ${n(issue.minimum)} ${count}.`;
        if (Number(issue.minimum) <= 1) return count === "caractères" ? "Champ obligatoire." : "Ajoutez au moins un élément.";
        return `Au moins ${n(issue.minimum)} ${count}.`;
      }
      if (issue.origin === "date") return "Date trop ancienne.";
      return issue.inclusive ? `Valeur minimale : ${n(issue.minimum)}.` : `La valeur doit dépasser ${n(issue.minimum)}.`;
    }
    case "too_big": {
      const count = issue.origin === "string" ? "caractères" : issue.origin === "array" || issue.origin === "set" ? "éléments" : null;
      if (count) return `${issue.exact ? "Exactement" : "Au plus"} ${n(issue.maximum)} ${count}.`;
      if (issue.origin === "file") return "Fichier trop volumineux.";
      if (issue.origin === "date") return "Date trop lointaine.";
      return issue.inclusive ? `Valeur maximale : ${n(issue.maximum)}.` : `La valeur doit rester sous ${n(issue.maximum)}.`;
    }
    case "invalid_format":
      return FORMATS[issue.format] ?? "Format invalide.";
    case "invalid_value":
      return "Choix invalide : sélectionnez une option proposée.";
    case "not_multiple_of":
      return `Valeur attendue par pas de ${n(issue.divisor)}.`;
    case "unrecognized_keys":
      return "Formulaire invalide : rechargez la page puis réessayez.";
    default:
      return "Valeur invalide.";
  }
};

/** Installe ces messages pour tout le processus (la configuration de Zod est globale). */
export function installFrenchValidationMessages() {
  config({ customError: frenchErrorMap });
}
