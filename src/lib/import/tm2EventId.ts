// TM2 event URLs embed the event id as a path segment after "event/", e.g.
// "https://tm2sign.com/app/event/2169" -- the id is a small integer, but treated as
// an opaque string throughout this adapter (matches every other path segment). Also
// accepts a bare id (no "event/" prefix) so pasting just the id works too. Mirrors
// aesEventId.ts/vbscheduleEventId.ts's parsing.
export function parseTm2EventIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/event\/([^/?#]+)/i);
  if (match) return match[1];

  // No "event/" segment found -- if the whole trimmed string looks like a bare id
  // (no slashes/whitespace), accept it as-is.
  if (/^[^\s/?#]+$/.test(trimmed)) return trimmed;

  return null;
}
