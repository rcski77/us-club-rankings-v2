import { prisma } from "@/lib/prisma";
import { computeColleyRatingsForSeason } from "@/lib/rating/computeColleyRatings";
import { computeEloRatingsForSeason } from "@/lib/rating/computeEloRatings";
import { computeMasseyRatingsForSeason } from "@/lib/rating/computeMasseyRatings";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";
import { computeClubRankingForSeason } from "@/lib/ranking/computeClubRanking";

/**
 * Nightly refresh: recomputes Colley/Elo/Massey power ratings, every division's
 * scoring-suggestion snapshot (the Analysis view), and both NPS/COMBINED club
 * rankings, for every active Season. This is the same work staff can already trigger
 * by hand ("Recompute ratings" on /admin/team-rankings, "Run analysis for all
 * divisions" on /admin/analysis, "Recompute ... club rankings" on
 * /admin/club-rankings) -- see ../../instrumentation.ts for what schedules this to run
 * automatically overnight.
 *
 * Runs in-process, not via the execFile worker pattern the request-triggered actions
 * use (recomputeRatingsInWorker.ts) -- that workaround exists to dodge Cloudflare's
 * ~100s proxy timeout on a synchronous HTTP request, which doesn't apply to a
 * background timer with no request waiting on it.
 */
export async function runNightlyRecompute(): Promise<void> {
  const seasons = await prisma.season.findMany({
    where: { isActive: true },
    select: { id: true, label: true },
  });

  for (const season of seasons) {
    const jobRun = await prisma.jobRun.create({
      data: { kind: "NIGHTLY_RECOMPUTE", seasonId: season.id, triggeredBy: "nightly" },
    });

    // Each season gets its own try/catch so one season's failure (e.g. the Elo
    // transaction timeout that motivated this file's JobRun tracking) doesn't abort
    // every later season silently -- previously an uncaught throw here would exit the
    // whole for-loop, leaving unrelated seasons' rankings stale with no record of why.
    try {
      // Sequential, not Promise.all -- see docs/dev-environment.md's note on concurrent
      // Prisma queries from the same pool.
      await computeColleyRatingsForSeason(season.id);
      await computeEloRatingsForSeason(season.id);
      await computeMasseyRatingsForSeason(season.id);

      const divisions = await prisma.division.findMany({
        where: { event: { seasonId: season.id } },
        select: { id: true, scoringStatus: true },
      });
      for (const division of divisions) {
        // CONFIRMED divisions get their stats refreshed without reopening finish/band
        // editing -- see computeDivisionScoringSuggestion's preserveStatus doc comment.
        await computeDivisionScoringSuggestion(division.id, {
          preserveStatus: division.scoringStatus === "CONFIRMED",
        });
      }

      // NPS first, then COMBINED -- COMBINED re-derives the Colley/Elo/Massey power
      // ratings just recomputed above (see computeClubRankingForSeason's own comment),
      // so both sources are safe to roll up here without a separate NPS-recompute step.
      await computeClubRankingForSeason(season.id, "NPS");
      await computeClubRankingForSeason(season.id, "COMBINED");

      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      });
    } catch (err) {
      console.error(`Nightly recompute failed for season ${season.id} (${season.label}):`, err);
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: { status: "FAILED", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
