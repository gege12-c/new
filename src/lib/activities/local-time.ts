/** Date et heure locales d'un instant, à partir d'un décalage connu ou d'un fuseau IANA. */

export interface LocalParts {
  date: string;
  time: string;
}

export function localParts(instant: Date, offsetSeconds: number | null, timeZone: string): LocalParts {
  if (offsetSeconds !== null) {
    const shifted = new Date(instant.getTime() + offsetSeconds * 1000).toISOString();
    return { date: shifted.slice(0, 10), time: shifted.slice(11, 19) };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}
