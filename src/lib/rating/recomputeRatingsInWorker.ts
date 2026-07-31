import { runInWorker } from "@/lib/import/runInWorker";

/**
 * Runs Colley/Elo/Massey recompute for a whole season in a separate process instead
 * of inline in the server action (see runInWorker.ts for why execFile, not
 * worker_threads/fork). "Recompute ratings" (team-rankings/page.tsx's
 * `recomputeAll`) refetches each engine's whole-season match/finish data --
 * including heavy `event`/`division`/`teamA+club`/`teamB+club` includes -- once per
 * age group per engine, then persists results. For a season with a full year of
 * events (tens of thousands of matches), run inline this pinned the request past
 * Cloudflare's ~100s proxy timeout on the homelab docker host, same shape of
 * problem as Resolve and the match-results import (see docs/plan.md's
 * "Team rankings recompute performance" note).
 */
export function recomputeRatingsInWorker(seasonId: string): Promise<void> {
  return runInWorker<{ seasonId: string }, void>("lib/rating/recomputeRatingsWorkerEntry.ts", { seasonId });
}
