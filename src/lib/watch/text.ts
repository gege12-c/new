/**
 * Texte pour les polices des montres : leur jeu de caractères est réduit (lettres accentuées
 * françaises comprises, mais ni apostrophe courbe, ni points de suspension, ni emoji). Les
 * signes typographiques sont remplacés par leur équivalent simple, le reste est retiré.
 */
export function watchText(text: string): string {
  return text
    .replace(/[’‘‛ʼ]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[^\n\u0020-\u007e\u00a0-\u00ff]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
