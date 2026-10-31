/**
 * Paquet d'un guide pour l'API Guides de Suunto : une archive zip de trois fichiers, manifest.json,
 * guide.json et icon.png (300 × 300 px). Entrées « stockées » (sans compression), comme le permet
 * le format zip : rien à dépendre, et une archive que tout lecteur relit. La lecture sert au
 * contrôle de chaque paquet avant envoi, et aux tests.
 */
import { GUIDE_ICON_PNG_BASE64 } from "./guide-icon";
import type { SuuntoGuide, SuuntoManifest } from "./guide";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true); // version nécessaire
    l.setUint16(6, 0x0800, true); // noms en UTF-8
    l.setUint16(8, 0, true); // stocké
    l.setUint32(14, crc, true);
    l.setUint32(18, entry.data.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const header = new Uint8Array(46 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, 0, true);
    h.setUint32(16, crc, true);
    h.setUint32(20, entry.data.length, true);
    h.setUint32(24, entry.data.length, true);
    h.setUint16(28, name.length, true);
    h.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    offset += local.length + entry.data.length;
  }
  const directorySize = central.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + directorySize + end.length);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Relit une archive zip à entrées stockées (celles que produit `buildZip`) ; erreur si elle est abîmée. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let endAt = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new Error("Archive zip sans répertoire central.");
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Répertoire central illisible.");
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (method !== 0) throw new Error(`Entrée compressée inattendue : ${name}.`);
    if (view.getUint32(localAt, true) !== 0x04034b50) throw new Error(`En-tête local illisible : ${name}.`);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = bytes.slice(dataAt, dataAt + size);
    if (crc32(data) !== crc) throw new Error(`Contrôle CRC faux : ${name}.`);
    entries.push({ name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function iconBytes(): Uint8Array {
  const binary = atob(GUIDE_ICON_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Les trois fichiers attendus par Suunto, dans une archive. */
export function packGuide(guide: SuuntoGuide, manifest: SuuntoManifest): Uint8Array {
  const encoder = new TextEncoder();
  return buildZip([
    { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) },
    { name: "guide.json", data: encoder.encode(JSON.stringify(guide)) },
    { name: "icon.png", data: iconBytes() },
  ]);
}

/** Dimensions d'une image PNG (en-tête IHDR), ou null si ce n'est pas un PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
