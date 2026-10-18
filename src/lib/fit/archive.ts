/**
 * Fichiers FIT livrés compressés : archive .zip (« Exporter le fichier d’origine » de Garmin Connect)
 * ou .fit.gz (export Strava). Décompression native du navigateur (DecompressionStream), sans
 * dépendance, avec des limites de taille contre les archives piégées.
 */
import { FitImportError } from "./parse";

export const MAX_FIT_BYTES = 30 * 1024 * 1024;
const MAX_ENTRIES = 20;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export interface NamedFile {
  name: string;
  data: ArrayBuffer;
}

async function inflate(data: Uint8Array, format: "deflate-raw" | "gzip", limit: number): Promise<ArrayBuffer> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new FitImportError("Fichier trop volumineux une fois décompressé (30 Mo au plus).");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

const isZip = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Fichiers .fit contenus dans une archive zip (méthodes « stocké » et « deflate »). */
async function unzipFitFiles(buffer: ArrayBuffer): Promise<NamedFile[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // Fin du répertoire central : cherchée depuis la fin (commentaire de 64 Ko au plus).
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new FitImportError("Archive zip illisible.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  if (count === 0xffff || cursor === 0xffffffff) throw new FitImportError("Archive zip trop volumineuse.");

  const decoder = new TextDecoder();
  const files: NamedFile[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new FitImportError("Archive zip illisible.");
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!/\.fit$/i.test(name) || name.endsWith("/")) continue;
    if (files.length >= MAX_ENTRIES) throw new FitImportError(`Archive : ${MAX_ENTRIES} fichiers FIT au plus.`);
    if (size > MAX_FIT_BYTES) throw new FitImportError("Fichier trop volumineux (30 Mo au plus).");
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new FitImportError("Archive trop volumineuse.");
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new FitImportError("Archive zip illisible.");
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(start, start + compressed);
    const baseName = name.split("/").pop() ?? name;
    if (method === 0) files.push({ name: baseName, data: data.slice().buffer });
    else if (method === 8) files.push({ name: baseName, data: await inflate(data, "deflate-raw", MAX_FIT_BYTES) });
    else throw new FitImportError("Méthode de compression non prise en charge.");
  }
  if (!files.length) throw new FitImportError("Aucun fichier FIT dans cette archive.");
  return files;
}

/** Fichiers FIT d’un fichier déposé : tel quel, décompressé (.gz) ou extrait d’une archive (.zip). */
export async function fitFilesFrom(name: string, buffer: ArrayBuffer): Promise<NamedFile[]> {
  const bytes = new Uint8Array(buffer);
  if (isZip(bytes)) return unzipFitFiles(buffer);
  if (isGzip(bytes)) return [{ name: name.replace(/\.gz$/i, ""), data: await inflate(bytes, "gzip", MAX_FIT_BYTES) }];
  if (buffer.byteLength > MAX_FIT_BYTES) throw new FitImportError("Fichier trop volumineux (30 Mo au plus).");
  return [{ name, data: buffer }];
}
