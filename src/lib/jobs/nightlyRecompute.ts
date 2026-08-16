import { prisma } from "@/lib/prisma";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";
import { computeClubRankingForSeason } from "@/lib/ranking/computeClubRanking";

// Generous over the ~21-31 min durations observed so far, so a slow-but-healthy run
// isn't mistaken for a stuck one -- but still bounded, so a ranking-compute crash that
// never updates its own JobRun row (see rankingComputeServer.ts) can't hang this
// function, and therefore the whole nightly job, forever.
const RATINGS_RECOMPUTE_POLL_TIMEOUT_MS = 40 * 60 * 1000;
const RATINGS_RECOMPUTE_POLL_INTERVAL_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Triggers a Colley/Elo/Massey recompute on the ranking-compute service and waits
 * for it to finish, unlike the manually-triggered "Recompute ratings" button (which
 * is genuinely fire-and-forget). Nightly's own later steps -- division scoring,
 * NPS/COMBINED club rankings -- re-derive from the ratings this triggers, so they
 * can't start on stale data; this has to actually block until ratings either
 * succeed or fail.
 *
 * Creates its own RATINGS_RECOMPUTE JobRun row (separate from the NIGHTLY_RECOMPUTE
 * row runNightlyRecompute() already tracks per season) so ratings progress is
 * visible on its own row here too, same as a manual trigger's.
 */
async function triggerAndAwaitRatingsRecompute(seasonId: string): Promise<void> {
  const jobRun = await prisma.jobRun.create({
    data: { kind: "RATINGS_RECOMPUTE", seasonId, triggeredBy: "nightly" },
  });

  const response = await fetch(`${process.env.RANKING_COMPUTE_URL}/recompute-ratings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seasonId, jobRunId: jobRun.id }),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    throw new Error(`Could not reach ranking-compute service: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!response.ok) {
    throw new Error(`ranking-compute service rejected the request: HTTP ${response.status}`);
  }

  const deadline = Date.now() + RATINGS_RECOMPUTE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(RATINGS_RECOMPUTE_POLL_INTERVAL_MS);
    const current = await prisma.jobRun.findUniqueOrThrow({ where: { id: jobRun.id } });
    if (current.status === "SUCCEEDED") return;
    if (current.status === "FAILED") throw new Error(current.error ?? "ranking-compute reported failure");
  }
  throw new Error(
    `ranking-compute did not report completion within ${RATINGS_RECOMPUTE_POLL_TIMEOUT_MS / 60_000} minutes`,
  );
}

/**
 * Nightly refresh: recomputes Colley/Elo/Massey power ratings, every division's
 * scoring-suggestion snapshot (the Analysis view), and both NPS/COMBINED club
 * rankings, for every active Season. This is the same work staff can already trigger
 * by hand ("Recompute ratings" on /admin/team-rankings, "Run analysis for all
 * divisions" on /admin/analysis, "Recompute ... club rankings" on
 * /admin/club-rankings) -- see ../../instrumentation.ts for what schedules this to run
 * automatically overnight.
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

    // Each season gets its own try/catch so one season's failure doesn't abort every
    // later season silently -- previously an uncaught throw here would exit the whole
    // for-loop, leaving unrelated seasons' rankings stale with no record of why.
    try {
      await triggerAndAwaitRatingsRecompute(season.id);

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
