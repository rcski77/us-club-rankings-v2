// TM2 (tm2sign.com) serves its public event/results data from a plain JSON REST API
// under /api/public/* -- confirmed against a real event (event 2169) via the app's
// own network requests, no auth/session required and no Cloudflare TLS-fingerprint
// block observed (like VBSchedule, unlike Sportwrench), so this uses fetch() rather
// than shelling out to curl like sportwrenchFetch.ts.
const TM2_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export async function fetchTm2Json<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": TM2_USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`TM2 request failed for "${url}": ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
