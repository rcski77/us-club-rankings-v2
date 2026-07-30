// Sportwrench event URLs embed the event id as a path segment after "events/", e.g.
// "https://events.sportwrench.com/#/events/c098ff439" (hash-routed) or
// "https://events2.sportwrench.com/events/c098ff439/divisions" (newer non-hash
// domain, see AES Scraping/Sportwrench/sw_graphql.py) -- the id itself is a short
// opaque hex-ish token. Also accepts a bare id (no "events/" prefix) so pasting just
// the id works too. Mirrors aesEventId.ts's parsing.
export function parseSportwrenchEventIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/events\/([^/?#]+)/i);
  if (match) return match[1];

  // No "events/" segment found -- if the whole trimmed string looks like a bare id
  // (no slashes/whitespace), accept it as-is.
  if (/^[^\s/?#]+$/.test(trimmed)) return trimmed;

  return null;
}
