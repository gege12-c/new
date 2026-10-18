import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseKey } from "./secret-box";

describe("chiffrement des jetons", () => {
  const key = randomBytes(32);

  it("chiffre et déchiffre, avec un résultat différent à chaque fois", () => {
    const a = encryptSecret("jeton-secret", key, "connexion-1");
    const b = encryptSecret("jeton-secret", key, "connexion-1");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("jeton-secret");
    expect(decryptSecret(a, key, "connexion-1")).toBe("jeton-secret");
  });

  it("refuse une autre clé, un autre contexte ou un texte altéré", () => {
    const box = encryptSecret("jeton-secret", key, "connexion-1");
    expect(() => decryptSecret(box, randomBytes(32), "connexion-1")).toThrow(/invalide/);
    expect(() => decryptSecret(box, key, "connexion-2")).toThrow(/invalide/);
    const parts = box.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."), key, "connexion-1")).toThrow(/invalide/);
    expect(() => decryptSecret("clair", key, "connexion-1")).toThrow(/illisible/);
  });

  it("lit une clé de 32 octets en base64 ou base64url, et rien d'autre", () => {
    const raw = randomBytes(32);
    expect(parseKey(raw.toString("base64"))?.equals(raw)).toBe(true);
    expect(parseKey(raw.toString("base64url"))?.equals(raw)).toBe(true);
    expect(parseKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseKey("pas une clé !")).toBeNull();
    expect(parseKey(undefined)).toBeNull();
  });
});
