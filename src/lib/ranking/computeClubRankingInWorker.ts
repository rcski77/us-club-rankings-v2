import { runInWorker } from "@/lib/import/runInWorker";
import type { ClubRankingSource } from "@/generated/prisma/enums";

/**
 * Runs computeClubRankingForSeason in a separate process instead of inline in the
 * server action -- same reason ratings recompute moved to the ranking-compute
 * service (see src/lib/rating/rankingComputeServer.ts and docs/plan.md's "Team
 * rankings recompute performance" note). The COMBINED source is
 * the expensive path: it calls computeCombinedRankByTeam once per age group, each of
 * which re-derives Power Rankings' Colley/Elo/Massey data (getLatestPowerRatings) on
 * top of the NPS RankingResult query the NPS source alone needs -- on a season with a
 * full year of real data this pinned the request past Cloudflare's ~100s proxy
 * timeout on the homelab docker host, same shape of problem as team ratings recompute
 * (NPS alone stayed fast enough not to show the problem, which is why it worked in
 * prod while COMBINED didn't).
 */
export function computeClubRankingInWorker(seasonId: string, source: ClubRankingSource): Promise<void> {
  return runInWorker<{ seasonId: string; source: ClubRankingSource }, void>(
    "lib/ranking/computeClubRankingWorkerEntry.ts",
    { seasonId, source },
  );
}
