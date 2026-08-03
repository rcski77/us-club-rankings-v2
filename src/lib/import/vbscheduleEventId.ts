// VBSchedule event URLs embed the event id as a path segment after "events/", e.g.
// "https://vbschedule.com/events/230" -- the id is a small integer, but treated as an
// opaque string throughout this adapter (matches every other path segment). Also
// accepts a bare id (no "events/" prefix) so pasting just the id works too. Mirrors
// aesEventId.ts/sportwrenchEventId.ts's parsing.
export function parseVbscheduleEventIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/events\/([^/?#]+)/i);
  if (match) return match[1];

  // No "events/" segment found -- if the whole trimmed string looks like a bare id
  // (no slashes/whitespace), accept it as-is.
  if (/^[^\s/?#]+$/.test(trimmed)) return trimmed;

  return null;
}
