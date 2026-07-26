// AES's results site sits behind Cloudflare, which can bot-block plain fetch requests
// that carry no User-Agent. Spoof a normal desktop browser fingerprint on every direct
// AES call to reduce that risk, and centralize the AbortSignal timeout so future call
// sites don't have to hand-roll it. Ported from aes-tourney-director/lib/aesFetch.ts,
// a sibling project's already-proven fetch pattern against this same API.
const AES_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export function fetchAes(url: string, opts: { timeoutMs?: number; headers?: HeadersInit } = {}): Promise<Response> {
  const { timeoutMs = 15000, headers } = opts;
  return fetch(url, {
    headers: {
      "User-Agent": AES_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://results.advancedeventsystems.com/",
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
