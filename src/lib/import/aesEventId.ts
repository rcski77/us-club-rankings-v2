// AES results URLs embed the event id as the last path segment, e.g.
// "https://results.advancedeventsystems.com/event/PTAwMDAwMzg4Mzk90" -- the id itself
// is an opaque base64-ish token, not necessarily numeric. Also accepts a bare id
// (no "/event/" prefix) so pasting just the id works too.
export function parseAesEventIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\/event\/([^/?#]+)/i);
  if (match) return match[1];

  // No "/event/" segment found -- if the whole trimmed string looks like a bare id
  // (no slashes/whitespace), accept it as-is.
  if (/^[^\s/?#]+$/.test(trimmed)) return trimmed;

  return null;
}
