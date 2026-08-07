/**
 * Next.js file-convention hook: `register()` runs once when a new server instance
 * starts (Node runtime only here -- these jobs need Prisma, which isn't Edge-safe;
 * see src/proxy.ts's own comment on why it stays Prisma-free). Starts two in-process
 * schedulers, since there's no separate job-queue/worker infra yet (docs/plan.md
 * Phase 6 -- nightlyRecompute was the first background job the app had):
 * - src/lib/jobs/nightlyRecompute.ts -- once a day, around a fixed hour.
 * - src/lib/jobs/cleanupExpiredSessions.ts -- expired-session housekeeping, on a
 *   plain fixed interval (see scheduleSessionCleanup.ts for why it doesn't need
 *   nightlyRecompute's wall-clock targeting).
 *
 * Both are deliberately hand-rolled timers, not a cron library -- see
 * scheduleNightlyRecompute.ts's own comment on why a `setInterval` poll covers what's
 * needed here without a new dependency. Both also only work correctly for a single
 * always-on server process (the homelab deploy is exactly that, per
 * docker-compose.prod.yml) -- if this app ever runs as multiple replicas, each
 * replica would fire its own run and this needs a real distributed-lock or job-queue
 * approach instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startNightlyRecomputeScheduler } = await import("./src/lib/jobs/scheduleNightlyRecompute");
  startNightlyRecomputeScheduler();

  const { startSessionCleanupScheduler } = await import("./src/lib/jobs/scheduleSessionCleanup");
  startSessionCleanupScheduler();
}
