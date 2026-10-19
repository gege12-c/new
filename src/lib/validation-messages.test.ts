import { afterEach, describe, expect, it } from "vitest";
import { config, z } from "zod";
import { frenchErrorMap, installFrenchValidationMessages, MISSING_FIELD } from "./validation-messages";

const message = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input, { error: frenchErrorMap });
  if (result.success) throw new Error("validation attendue en échec");
  return result.error.issues[0].message;
};

describe("messages de validation par défaut", () => {
  afterEach(() => config({ customError: undefined }));

  it("un champ absent du formulaire, comme le seuil du 19 octobre", () => {
    expect(message(z.object({ notes: z.string() }), {})).toBe(MISSING_FIELD);
    expect(MISSING_FIELD).toBe("Information manquante : rechargez la page puis réessayez.");
  });

  it("types, longueurs et bornes", () => {
    expect(message(z.number(), "deux")).toBe("Nombre attendu.");
    expect(message(z.string().min(1), "")).toBe("Champ obligatoire.");
    expect(message(z.string().min(8), "abc")).toBe("Au moins 8 caractères.");
    expect(message(z.string().max(60), "x".repeat(61))).toBe("Au plus 60 caractères.");
    expect(message(z.number().min(30), 12)).toBe("Valeur minimale : 30.");
    expect(message(z.number().max(700), 701.5)).toBe("Valeur maximale : 700.");
    expect(message(z.array(z.string()).min(1), [])).toBe("Ajoutez au moins un élément.");
  });

  it("formats et choix", () => {
    expect(message(z.email(), "gerald@")).toBe("Adresse email invalide.");
    expect(message(z.iso.date(), "19/10/2026")).toBe("Date invalide.");
    expect(message(z.uuid(), "abc")).toBe("Identifiant invalide : rechargez la page puis réessayez.");
    expect(message(z.enum(["A", "B"]), "Z")).toBe("Choix invalide : sélectionnez une option proposée.");
    expect(message(z.strictObject({}), { extra: 1 })).toBe("Formulaire invalide : rechargez la page puis réessayez.");
  });

  it("le message écrit dans le schéma reste prioritaire", () => {
    expect(message(z.string().min(1, "Saisissez une valeur."), "")).toBe("Saisissez une valeur.");
  });

  it("une fois installés, ils valent pour tous les schémas, sans un mot d'anglais", () => {
    installFrenchValidationMessages();
    const result = z.object({ athlete_id: z.uuid(), value: z.string(), when: z.iso.date() }).safeParse({ athlete_id: "x", when: "hier" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message);
    expect(messages).toEqual(["Identifiant invalide : rechargez la page puis réessayez.", MISSING_FIELD, "Date invalide."]);
    expect(messages.join(" ")).not.toMatch(/Invalid input|expected|received|Too (small|big)/);
  });
});
