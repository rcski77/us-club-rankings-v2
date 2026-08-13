import { prisma } from "@/lib/prisma";
import { getPartitionMatches, withDivisionWeights, type PartitionMatchesCache } from "./computeEloRatings";
import { buildMasseyMatches, solveMassey } from "./massey";
import { normalizeWeekEndingDate } from "./weekEndingDate";
import {
  mapWithConcurrency,
  PARTITION_RECOMPUTE_CONCURRENCY,
  PARTITION_TRANSACTION_MAX_WAIT,
} from "@/lib/concurrency";

/**
 * Recomputes Massey ratings for one (season, ageGroup) partition as of asOfDate, and
 * persists a weekly TeamRatingHistory snapshot dated weekEndingDate, mirroring
 * computeEloRatingsForPartition()'s pattern exactly (same getPartitionMatches, same
 * delete-and-replace transaction) but with the batch least-squares Massey solve in
 * place of Elo's sequential replay.
 *
 * Like Elo, Massey has no standings-inferred fallback: it only exists once real
 * match-level point scores do, so a division with only finish ranks (no imported
 * Match rows) contributes nothing here.
 *
 * Division-strength weighting (see divisionWeight.ts) applies here too, via the same
 * withDivisionWeights() helper Elo uses -- one weight per division, computed once and
 * reused by both engines, so Colley -> {Elo, Massey} weighting can never disagree
 * between the two on what a given division's strength weight is. Massey scales its
 * matrix contribution per match (see massey.ts's solveMassey) rather than a K-factor,
 * since Massey has no K to scale.
 *
 * solveMassey() returns a rating for every team in the match graph, including any
 * team playing up from another age group (see getPartitionMatches's own comment) --
 * filtered out via relevantTeamIds before ranking/persisting, same as
 * computeEloRatingsForPartition.
 */
export async function computeMasseyRatingsForPartition(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  weekEndingDateRaw: Date,
  cache?: PartitionMatchesCache,
) {
  // See weekEndingDate.ts -- collapses same-day recomputes onto one timestamp so
  // delete-and-replace below actually replaces instead of piling up.
  const weekEndingDate = normalizeWeekEndingDate(weekEndingDateRaw);

  const { matches, relevantTeamIds } = await getPartitionMatches(seasonId, ageGroup, asOfDate, cache);
  const weighted = await withDivisionWeights(matches);
  const masseyMatches = buildMasseyMatches(
    weighted.map((m) => ({
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      setScores: Array.isArray(m.setScores) ? (m.setScores as unknown as { a: number; b: number }[]) : [],
      divisionWeight: m.divisionWeight,
    })),
  );
  const ratings = solveMassey(masseyMatches).filter((r) => relevantTeamIds.has(r.teamId));

  ratings.sort((a, b) => b.rating - a.rating);
  let rank = 0;
  let lastRating: number | null = null;
  const ranked = ratings.map((r, i) => {
    if (r.rating !== lastRating) {
      rank = i + 1;
      lastRating = r.rating;
    }
    return { ...r, rank };
  });

  await prisma.$transaction(async (tx) => {
    await tx.teamRatingHistory.deleteMany({
      where: { seasonId, ageGroup, weekEndingDate, ratingEngine: "MASSEY" },
    });
    if (ranked.length > 0) {
      await tx.teamRatingHistory.createMany({
        data: ranked.map((r) => ({
          teamId: r.teamId,
          seasonId,
          ageGroup,
          weekEndingDate,
          ratingEngine: "MASSEY" as const,
          rating: r.rating,
          rank: r.rank,
          comparisons: r.comparisons,
        })),
      });
    }
  }, { maxWait: PARTITION_TRANSACTION_MAX_WAIT, timeout: PARTITION_TRANSACTION_MAX_WAIT });

  return ranked;
}

/**
 * Recomputes Massey ratings for every distinct ageGroup with a TeamSeason row this
 * season. See computeEloRatingsForSeason's own comment -- same bounded-concurrency
 * partition loop, same shared-`cache` mechanism to avoid re-fetching each partition's
 * matches a second time when Elo already fetched them in the same recompute run.
 */
export async function computeMasseyRatingsForSeason(
  seasonId: string,
  asOfDate: Date = new Date(),
  weekEndingDate: Date = new Date(),
  cache: PartitionMatchesCache = new Map(),
) {
  const teamSeasons = await prisma.teamSeason.findMany({
    where: { seasonId },
    select: { ageGroup: true },
    distinct: ["ageGroup"],
  });

  const ageGroups = teamSeasons.map((ts) => ts.ageGroup);
  const ranked = await mapWithConcurrency(ageGroups, PARTITION_RECOMPUTE_CONCURRENCY, (ageGroup) =>
    computeMasseyRatingsForPartition(seasonId, ageGroup, asOfDate, weekEndingDate, cache),
  );

  const results = new Map<number, Awaited<ReturnType<typeof computeMasseyRatingsForPartition>>>();
  ageGroups.forEach((ageGroup, i) => results.set(ageGroup, ranked[i]));
  return results;
}
