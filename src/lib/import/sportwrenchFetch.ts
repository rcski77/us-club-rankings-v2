import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SPORTWRENCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export type SportwrenchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

/**
 * Sportwrench's public events API sits behind Cloudflare bot protection that
 * fingerprints the TLS/HTTP client itself, not just headers -- confirmed directly
 * against the real API: Node's built-in fetch (undici) gets a 403 "Just a moment..."
 * JS-challenge page on every request even with a real Chrome User-Agent, while curl
 * with the identical User-Agent consistently gets a real 200. This is exactly why
 * the sibling scraper (`AES Scraping/US Club Rankings/usclub_sw.py`) uses
 * curl_cffi's Chrome TLS impersonation instead of Python's plain `requests` --
 * AES itself has no such fingerprinting, which is why aesFetch.ts can use a plain
 * fetch(). Shelling out to the system's real curl binary (present by default on
 * Windows 10+, and on the Linux images this kind of app typically deploys to)
 * reproduces curl's own TLS fingerprint exactly, sidestepping the problem without a
 * new npm dependency -- chosen over a TLS-impersonation library or a headless
 * browser per explicit user decision.
 */
export async function fetchSportwrench(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<SportwrenchResponse> {
  const { timeoutMs = 15000 } = opts;

  const args = [
    "-s", // silent -- no progress meter
    "-S", // but still show errors on stderr
    "-A",
    SPORTWRENCH_USER_AGENT,
    "-H",
    "Accept: application/json",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    "-e",
    "https://events.sportwrench.com/", // referer
    "--max-time",
    String(Math.ceil(timeoutMs / 1000)),
    // Body on stdout, then a newline and the HTTP status code -- split apart below
    // instead of using `-i` (which would mix response headers into the body).
    "-w",
    "\n%{http_code}",
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("curl", args, { maxBuffer: 50 * 1024 * 1024 }));
  } catch (err) {
    throw new Error(
      `curl request to Sportwrench failed for "${url}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const splitAt = stdout.lastIndexOf("\n");
  const body = splitAt === -1 ? "" : stdout.slice(0, splitAt);
  const status = Number(stdout.slice(splitAt + 1).trim());

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => JSON.parse(body),
  };
}
