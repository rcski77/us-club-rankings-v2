// VBSchedule is an Inertia.js app: unlike AES/Sportwrench, there's no separate JSON
// API -- every page's initial HTML embeds the full server-rendered props as JSON in
// a single `<script data-page="app" type="application/json">` tag (confirmed against
// the real event https://vbschedule.com/events/230). No Cloudflare TLS-fingerprint
// block like Sportwrench's (a plain `fetch()` with a normal User-Agent gets a clean
// 200 directly, verified against the real site), so this can use fetch() like
// aesFetch.ts rather than shelling out to curl like sportwrenchFetch.ts.
const VBSCHEDULE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const DATA_PAGE_RE = /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/;

export type VbscheduleInertiaPage<TProps> = { component: string; props: TProps; url: string };

/**
 * Fetches a VBSchedule page and extracts its embedded Inertia props JSON. Every
 * vbschedule*.ts fetcher in this adapter goes through this one function so the
 * HTML-scraping detail (the regex, the User-Agent, error shape) lives in exactly one
 * place.
 */
export async function fetchVbschedulePage<TProps>(url: string, timeoutMs = 15000): Promise<VbscheduleInertiaPage<TProps>> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": VBSCHEDULE_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`VBSchedule request failed for "${url}": ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const match = html.match(DATA_PAGE_RE);
  if (!match) {
    throw new Error(`VBSchedule page at "${url}" did not contain the expected embedded data.`);
  }
  return JSON.parse(match[1]) as VbscheduleInertiaPage<TProps>;
}
