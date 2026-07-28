import { prisma } from "@/lib/prisma";
import { buildDivisionComparisons, buildMatchComparisons, solveColley } from "./colley";

/**
 * Recomputes Colley ratings for one (season, ageGroup) partition as of asOfDate, and
 * persists a weekly TeamRatingHistory snapshot dated weekEndingDate. Mirrors
 * computeRanking()'s delete-and-replace-by-partition pattern (see
 * src/lib/ranking/computeRanking.ts) and its ignoreAge resolution: a finish's
 * comparisons feed the TEAM's natural age group (per that season's TeamSeason row),
 * not necessarily the division's own age group -- consistent with how ignoreAge
 * finishes already count toward the points-based ranking.
 *
 * Per division, imported Match results are preferred over standings when available --
 * real head-to-head results are a stronger signal than rank-inferred comparisons --
 * and the standings (TeamFinish rank) fallback is used otherwise, since match import
 * coverage (Phase 5) currently trails standings import coverage (Phase 2) and most
 * divisions won't have Match rows yet. This is a per-division, not per-team or
 * per-match, decision: a division with any completed Match rows uses match results
 * exclusively (not a mix of the two signals for the same division).
 *
 * The standings fallback additionally requires the division's scoringStatus to be
 * CONFIRMED -- a TeamFinish's rank is still editable up until then (see
 * addTeamFinish/removeTeamFinish/updateTeamFinishRank), so rank-inferred comparisons
 * need to wait for it to settle. Real Match results have no such instability (a
 * separate, non-editable import), so the match-based path is NOT gated on confirm --
 * a division with real results gets rated as soon as they're imported, independent of
 * the unrelated point-curve confirmation workflow.
 *
 * A division qualifies as "relevant" here as soon as any one team's finish belongs to
 * this ageGroup, but its match results (buildMatchComparisons) are pulled in for the
 * whole division -- including a team playing up from another age group -- because an
 * opponent's true strength should reflect having faced that team. solveColley()
 * therefore returns a rating for that playing-up team too; it's filtered out via
 * relevantTeamIds before ranking/persisting, or it would end up with its own rating
 * recorded under the wrong ageGroup (e.g. a 15u team appearing in the 17u power
 * rankings).
 */
export async function computeColleyRatings(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  weekEndingDate: Date,
) {
  const finishes = await prisma.teamFinish.findMany({
    where: {
      division: { event: { seasonId, startDate: { lte: asOfDate } } },
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
  const relevantTeamIds = new Set(relevant.map((f) => f.teamId));

  const byDivision = new Map<string, typeof relevant>();
  for (const finish of relevant) {
    const list = byDivision.get(finish.divisionId) ?? [];
    list.push(finish);
    byDivision.set(finish.divisionId, list);
  }

  const divisionIds = Array.from(byDivision.keys());
  const matches = divisionIds.length
    ? await prisma.match.findMany({
        where: { divisionId: { in: divisionIds }, winnerTeamId: { not: null } },
      })
    : [];
  const matchesByDivision = new Map<string, typeof matches>();
  for (const m of matches) {
    if (!m.divisionId) continue;
    const list = matchesByDivision.get(m.divisionId) ?? [];
    list.push(m);
    matchesByDivision.set(m.divisionId, list);
  }

  const comparisons = Array.from(byDivision.entries()).flatMap(([divisionId, finishes]) => {
    const divisionMatches = matchesByDivision.get(divisionId);
    if (divisionMatches && divisionMatches.length > 0) return buildMatchComparisons(divisionMatches);
    const isConfirmed = finishes[0]?.division.scoringStatus === "CONFIRMED";
    return isConfirmed ? buildDivisionComparisons(finishes) : [];
  });
  const ratings = solveColley(comparisons).filter((r) => relevantTeamIds.has(r.teamId));

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
