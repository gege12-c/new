/**
 * Chiffrement des secrets stockés en base (jetons OAuth) : AES-256-GCM, clé hors de la base.
 * Format : « v1.<iv>.<chiffré>.<étiquette> » en base64url. Le contexte (identifiant de la connexion)
 * est authentifié : un jeton recopié sur une autre ligne ne se déchiffre pas.
 */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_BYTES = 32;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/** Lit une clé de 32 octets encodée en base64 ou base64url ; null si absente ou invalide. */
export function parseKey(value: string | undefined | null): Buffer | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return key.length === KEY_BYTES ? key : null;
}

export function encryptSecret(plain: string, key: Buffer, context: string): string {
  if (key.length !== KEY_BYTES) throw new SecretBoxError("Clé de chiffrement invalide.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptSecret(box: string, key: Buffer, context: string): string {
  const parts = box.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError("Secret chiffré illisible.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("Secret chiffré invalide, ou clé différente de celle du chiffrement.");
  }
}
