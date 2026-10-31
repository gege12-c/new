/** Conversions entre heure locale d’un fuseau et instant UTC, sans dépendance. */

/** Décalage (ms) du fuseau à un instant donné. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Heure locale « 2026-11-02T07:30:00 » d'un fuseau → instant UTC. */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const naive = Date.parse(`${local.slice(0, 19)}Z`);
  // Deux passes : le décalage peut changer autour du changement d'heure.
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}
