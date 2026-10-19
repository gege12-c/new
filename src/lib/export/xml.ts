/**
 * XML minimal pour les fichiers .zwo : échappement à l'écriture, et relecture stricte (bien formé,
 * balises appariées, attributs entre guillemets) pour valider ce qui a été produit.
 */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Caractères de contrôle interdits en XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITIES[entity];
  });
}

export class XmlError extends Error {}

/** Analyse un document XML simple (sans DTD ni CDATA) ; lève XmlError s'il est mal formé. */
export function parseXml(source: string): XmlElement {
  let i = 0;
  const text = source.replace(/^﻿/, "");
  const fail = (message: string): never => {
    throw new XmlError(`${message} (position ${i})`);
  };
  const skipSpaces = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  const skipMisc = () => {
    for (;;) {
      skipSpaces();
      if (text.startsWith("<?", i)) {
        const end = text.indexOf("?>", i);
        if (end < 0) fail("Déclaration XML non terminée");
        i = end + 2;
      } else if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i);
        if (end < 0) fail("Commentaire non terminé");
        i = end + 3;
      } else return;
    }
  };
  const readName = () => {
    const match = /^[A-Za-z_][\w.-]*/.exec(text.slice(i));
    if (!match) fail("Nom de balise attendu");
    i += match![0].length;
    return match![0];
  };
  const readElement = (): XmlElement => {
    if (text[i] !== "<") fail("« < » attendu");
    i += 1;
    const name = readName();
    const attributes: Record<string, string> = {};
    for (;;) {
      skipSpaces();
      if (text.startsWith("/>", i)) {
        i += 2;
        return { name, attributes, children: [], text: "" };
      }
      if (text[i] === ">") {
        i += 1;
        break;
      }
      const attribute = readName();
      skipSpaces();
      if (text[i] !== "=") fail(`« = » attendu après ${attribute}`);
      i += 1;
      skipSpaces();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail(`Valeur de ${attribute} sans guillemets`);
      const end = text.indexOf(quote, i + 1);
      if (end < 0) fail(`Valeur de ${attribute} non terminée`);
      const raw = text.slice(i + 1, end);
      if (raw.includes("<")) fail(`« < » interdit dans ${attribute}`);
      if (attribute in attributes) fail(`Attribut ${attribute} en double`);
      attributes[attribute] = decode(raw);
      i = end + 1;
    }
    const children: XmlElement[] = [];
    let content = "";
    for (;;) {
      if (i >= text.length) fail(`Balise ${name} non fermée`);
      if (text.startsWith("</", i)) {
        i += 2;
        const closing = readName();
        if (closing !== name) fail(`Fermeture ${closing} au lieu de ${name}`);
        skipSpaces();
        if (text[i] !== ">") fail("« > » attendu");
        i += 1;
        return { name, attributes, children, text: decode(content).trim() };
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i);
        if (end < 0) fail("Commentaire non terminé");
        i = end + 3;
        continue;
      }
      if (text[i] === "<") {
        children.push(readElement());
        continue;
      }
      const next = text.indexOf("<", i);
      if (next < 0) fail(`Balise ${name} non fermée`);
      content += text.slice(i, next);
      i = next;
    }
  };
  skipMisc();
  const root = readElement();
  skipMisc();
  if (i < text.length) fail("Contenu après l'élément racine");
  return root;
}
