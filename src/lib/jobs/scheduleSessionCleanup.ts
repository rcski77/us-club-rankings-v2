import { cleanupExpiredSessions } from "./cleanupExpiredSessions";
import { pruneStaleLoginRateLimitBuckets } from "@/lib/loginRateLimit";

// No wall-clock target like scheduleNightlyRecompute's TARGET_HOUR -- expired
// sessions are inert clutter, not something that needs clearing at a specific
// time, so a plain fixed interval is enough. Also piggybacks pruning the
// login-rate-limit buckets (src/lib/loginRateLimit.ts) -- unrelated data, but
// the same "periodic, no urgency" housekeeping shape, so it doesn't warrant
// its own scheduler/interval.
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let started = false;

export function startSessionCleanupScheduler(): void {
  if (started) return;
  started = true;

  const tick = () => {
    cleanupExpiredSessions()
      .then((count) => {
        if (count > 0) console.log(`[sessionCleanup] deleted ${count} expired session(s)`);
      })
      .catch((err) => console.error("[sessionCleanup] run failed:", err));
    pruneStaleLoginRateLimitBuckets();
  };

  // Also run once at startup -- otherwise a dev server restarted mid-afternoon
  // waits up to 6h for its first sweep.
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}
