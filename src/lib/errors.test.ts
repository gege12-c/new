import { isMissingSchema, SCHEMA_PENDING_MESSAGE } from "@/lib/supabase/schema";
import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("messages d'erreur", () => {
  it("traduit les codes métier de la base", () => {
    expect(friendlyError({ message: "invitation_expired", code: "22023" })).toMatch(/expiré/);
    expect(friendlyError({ message: "athlete_can_only_reschedule" })).toMatch(/déplacer/);
  });

  it("explique un envoi d'email impossible", () => {
    expect(friendlyError({ code: "email_address_not_authorized" })).toMatch(/envoi d’emails/);
    expect(friendlyError({ message: "Error sending confirmation email" })).toMatch(/envoi d’emails/);
  });

  it("garde un message générique pour l'inconnu", () => {
    expect(friendlyError({ message: "boom" }, "Échec.")).toBe("Échec.");
    expect(friendlyError(null)).toMatch(/Réessayez/);
  });
});

describe("base en retard sur le code", () => {
  it("reconnaît une table ou une fonction absente et l’explique", () => {
    expect(isMissingSchema({ code: "PGRST205", message: "Could not find the table 'public.activities' in the schema cache" })).toBe(true);
    expect(isMissingSchema({ code: "PGRST202" })).toBe(true);
    expect(isMissingSchema({ code: "42P01" })).toBe(true);
    expect(isMissingSchema({ code: "23505" })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
    expect(friendlyError({ code: "PGRST205", message: "x" })).toBe(SCHEMA_PENDING_MESSAGE);
  });
});

