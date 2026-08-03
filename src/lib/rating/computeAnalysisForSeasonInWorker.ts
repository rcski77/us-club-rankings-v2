import { runInWorker } from "@/lib/import/runInWorker";

/**
 * Runs computeDivisionScoringSuggestion for every division in a season (every age
 * group at once) in a separate process instead of inline in the server action -- see
 * computeAnalysisForSeasonWorkerEntry.ts and runInWorker.ts for why. A season can have
 * hundreds of divisions across all age groups combined, each requiring several Prisma
 * queries (field strength, Elo population, template list, ...), so run inline this
 * risks the same ~100s Cloudflare proxy timeout already solved for "Recompute ratings"
 * (recomputeRatingsInWorker.ts) and club rankings (computeClubRankingInWorker.ts).
 */
export function computeAnalysisForSeasonInWorker(seasonId: string): Promise<void> {
  return runInWorker<{ seasonId: string }, void>(
    "lib/rating/computeAnalysisForSeasonWorkerEntry.ts",
    { seasonId },
  );
}
