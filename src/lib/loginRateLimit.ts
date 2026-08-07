// Guards against a scripted burst hitting /login fast, regardless of which
// email it's trying -- the per-account lockout in src/auth.ts only trips once
// one specific account has racked up 5 wrong passwords, so it does nothing
// against a script cycling through many different emails, or just hammering
// the endpoint to see what happens.
//
// In-memory, per-process -- consistent with this app's other in-process-only
// assumptions (see instrumentation.ts's own comment on the nightly job). Resets
// on restart/deploy, which is fine: this exists to blunt a fast burst, not to
// be a durable record -- the DB-backed per-account lockout is what persists.

type Bucket = { count: number; windowStart: number };

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS_PER_WINDOW = 10;

const buckets = new Map<string, Bucket>();

// Returns true if `key` (an IP, or "unknown" if none could be determined) has
// already made MAX_ATTEMPTS_PER_WINDOW login attempts within the current window.
export function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS_PER_WINDOW;
}

// Called periodically (see scheduleSessionCleanup.ts) so `buckets` doesn't grow
// forever from one-off IPs that never come back -- correctness doesn't depend
// on this (isLoginRateLimited resets any bucket older than WINDOW_MS on its
// own), it's purely to bound memory.
export function pruneStaleLoginRateLimitBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}
