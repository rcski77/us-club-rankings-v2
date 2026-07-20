import { prisma } from "@/lib/prisma";
import { buildDivisionComparisons, solveColley } from "./colley";

/**
 * Recomputes Colley ratings for one (season, ageGroup) partition as of asOfDate, and
 * persists a weekly TeamRatingHistory snapshot dated weekEndingDate. Mirrors
 * computeRanking()'s delete-and-replace-by-partition pattern (see
 * src/lib/ranking/computeRanking.ts) and its ignoreAge resolution: a finish's
 * comparisons feed the TEAM's natural age group (per that season's TeamSeason row),
 * not necessarily the division's own age group -- consistent with how ignoreAge
 * finishes already count toward the points-based ranking.
 */
export async function computeColleyRatings(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  weekEndingDate: Date,
) {
  const finishes = await prisma.teamFinish.findMany({
    where: {
      division: {
        event: { seasonId, startDate: { lte: asOfDate } },
        scoringStatus: "CONFIRMED",
      },
    },
    include: { division: true },
  });

  const teamSeasons = await prisma.teamSeason.findMany({ where: { seasonId } });
  const naturalAgeGroup = new Map(teamSeasons.map((ts) => [ts.teamId, ts.ageGroup]));

  const relevant = finishes.filter(
    (f) =>
      (f.division.ageGroup === ageGroup && !f.ignoreAge) ||
      (f.ignoreAge && naturalAgeGroup.get(f.teamId) === ageGroup),
  );

  const byDivision = new Map<string, typeof relevant>();
  for (const finish of relevant) {
    const list = byDivision.get(finish.divisionId) ?? [];
    list.push(finish);
    byDivision.set(finish.divisionId, list);
  }

  const comparisons = Array.from(byDivision.values()).flatMap(buildDivisionComparisons);
  const ratings = solveColley(comparisons);

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
      where: { seasonId, ageGroup, weekEndingDate, ratingEngine: "COLLEY" },
    });
    for (const r of ranked) {
      await tx.teamRatingHistory.create({
        data: {
          teamId: r.teamId,
          seasonId,
          ageGroup,
          weekEndingDate,
          ratingEngine: "COLLEY",
          rating: r.rating,
          rank: r.rank,
          comparisons: r.comparisons,
        },
      });
    }
  });

  return ranked;
}

/** Recomputes Colley ratings for every distinct ageGroup with a TeamSeason row this season. */
export async function computeColleyRatingsForSeason(
  seasonId: string,
  asOfDate: Date = new Date(),
  weekEndingDate: Date = new Date(),
) {
  const teamSeasons = await prisma.teamSeason.findMany({
    where: { seasonId },
    select: { ageGroup: true },
    distinct: ["ageGroup"],
  });

  const results = new Map<number, Awaited<ReturnType<typeof computeColleyRatings>>>();
  for (const { ageGroup } of teamSeasons) {
    const ranked = await computeColleyRatings(seasonId, ageGroup, asOfDate, weekEndingDate);
    results.set(ageGroup, ranked);
  }
  return results;
}
