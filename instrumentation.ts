/**
 * Next.js file-convention hook: `register()` runs once when a new server instance
 * starts (Node runtime only here -- the nightly job needs Prisma, which isn't
 * Edge-safe; see src/proxy.ts's own comment on why it stays Prisma-free). Used here to
 * start an in-process nightly scheduler for src/lib/jobs/nightlyRecompute.ts, since
 * there's no separate job-queue/worker infra yet (docs/plan.md Phase 6 -- this is the
 * first background job the app has).
 *
 * Deliberately a hand-rolled timer, not a cron library: the only requirement is "once
 * a day, around a fixed hour," and a `setInterval` poll comparing wall-clock time in a
 * fixed zone against a target hour covers that without a new dependency. This only
 * works correctly for a single always-on server process (the homelab deploy is exactly
 * that, per docker-compose.prod.yml) -- if this app ever runs as multiple replicas,
 * each replica would fire its own nightly run and this needs a real distributed-lock
 * or job-queue approach instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startNightlyRecomputeScheduler } = await import("./src/lib/jobs/scheduleNightlyRecompute");
  startNightlyRecomputeScheduler();
}
