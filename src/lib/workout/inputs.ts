/**
 * Saisie des valeurs d’une séance : durées « 1:30:00 », « 45 », « 45 min », « 90 s » ;
 * distances « 400 », « 1,5 km » ; allures « 4:35 ». Renvoie null quand la saisie est illisible :
 * l’éditeur garde alors la valeur précédente et signale l’erreur, sans rien deviner.
 *
 * Le clavier numérique d’un téléphone n’a pas de deux-points : une virgule ou un point suivis de
 * deux chiffres valent des secondes (« 4,30 » = 4:30, « 0,20 » = 20 s), et une allure s’écrit aussi
 * d’un bloc (« 430 » = 4:30). La valeur comprise s’affiche aussitôt dans le champ.
 */

const normalize = (raw: string) => raw.trim().toLowerCase().replace(",", ".").replace(/\s+/g, " ");

/** Durée en secondes. Un nombre seul est lu en minutes. */
export function parseDuration(raw: string): number | null {
  // Séparateurs du clavier numérique : « 4,30 » ou « 4.30 » comme « 4:30 », « 1,30,00 » comme « 1:30:00 ».
  const keypad = raw.trim().match(/^(\d+)[.,'’]([0-5]\d)(?:[.,'’]([0-5]\d))?$/);
  const value = keypad ? `${keypad[1]}:${keypad[2]}${keypad[3] ? `:${keypad[3]}` : ""}` : normalize(raw);
  if (!value) return null;
  const clock = value.match(/^(\d+):([0-5]?\d)(?::([0-5]\d))?$/);
  if (clock) {
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] === undefined ? null : Number(clock[3])];
    const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c;
    return seconds > 0 ? seconds : null;
  }
  const units = value.match(/^(\d+(?:\.\d+)?) ?(h|min|mn|m|s|sec)?$/);
  if (units) {
    const n = Number(units[1]);
    const factor = units[2] === "h" ? 3600 : units[2] === "s" || units[2] === "sec" ? 1 : 60;
    const seconds = Math.round(n * factor);
    return seconds > 0 ? seconds : null;
  }
  const hm = value.match(/^(\d+) ?h ?(\d{1,2})(?: ?min)?$/);
  if (hm) {
    const seconds = Number(hm[1]) * 3600 + Number(hm[2]) * 60;
    return seconds > 0 ? seconds : null;
  }
  return null;
}

/** Durée pour un champ de saisie : « 45:00 », « 1:30:00 ». */
export function formatDurationInput(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(rest)}` : `${m}:${pad(rest)}`;
}

/** Distance en mètres. Un nombre seul est lu en mètres ; « km » convertit. */
export function parseDistance(raw: string): number | null {
  const value = normalize(raw);
  const match = value.match(/^(\d+(?:\.\d+)?) ?(km|m)?$/);
  if (!match) return null;
  const meters = Number(match[1]) * (match[2] === "km" ? 1000 : 1);
  return meters > 0 ? Math.round(meters * 10) / 10 : null;
}

export function formatDistanceInput(meters: number): string {
  if (meters >= 1000 && meters % 100 === 0) return `${String(meters / 1000).replace(".", ",")} km`;
  return String(meters).replace(".", ",");
}

/**
 * Allure en secondes (par km ou par 100 m selon le champ) : « 4:30 », « 4,30 », « 4.30 », « 4'30 »,
 * « 4 30 » ou « 430 » (minutes puis deux chiffres de secondes). Les secondes ont toujours deux
 * chiffres : « 4,5 » (4:05 ou 4:50 ?) et « 90 » (1:30 ou 0:90 ?) sont refusés plutôt que devinés.
 */
export function parsePace(raw: string): number | null {
  const value = raw.trim().toLowerCase().replace(/\s*\/\s*(km|100\s*m)$/, "");
  const match = value.match(/^(\d{1,2})\s*[:.,'’ ]\s*([0-5]\d)$/) ?? value.match(/^(\d{1,2})([0-5]\d)$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds > 0 ? seconds : null;
}

/** Nombre décimal saisi à la française. */
export function parseNumber(raw: string): number | null {
  const value = normalize(raw);
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  return Number(value);
}

export function formatNumberInput(n: number): string {
  return String(n).replace(".", ",");
}
