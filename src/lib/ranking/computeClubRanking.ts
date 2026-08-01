import { prisma } from "@/lib/prisma";
import { AGE_GROUPS, computeClubScore, rankClubs, type BestRankByAgeGroup } from "./clubRanking";

const ALGORITHM_VERSION = "phase7-v1";

/**
 * Recomputes the club-level ranking for a whole season (not per age group -- a
 * club's score spans every age group at once, see docs/plan.md §8). Reads the
 * already-computed team-level RankingResult rows for the season rather than
 * re-deriving anything from TeamFinish -- §8's "highest-ranked team only per age
 * group" rule makes this a cheap rollup over data the team-level ranking already
 * produced.
 */
export async function computeClubRankingForSeason(seasonId: string) {
  const results = await prisma.rankingResult.findMany({
    where: { seasonId, ageGroup: { in: [...AGE_GROUPS] } },
    include: { team: true },
  });

  // For each (club, ageGroup), keep only the club's best-ranked (lowest rank number)
  // team -- §8 point 2: "the club's highest-ranked team only... not all of the
  // club's teams."
  const bestByClub = new Map<string, BestRankByAgeGroup>();
  for (const r of results) {
    const clubId = r.team.clubId;
    if (!clubId) continue; // unlinked team -- no club to roll up into
    const ageGroup = r.ageGroup as (typeof AGE_GROUPS)[number];

    const entry = bestByClub.get(clubId) ?? {};
    const existing = entry[ageGroup];
    if (!existing || r.rank < existing.rank) {
      entry[ageGroup] = { teamId: r.teamId, rank: r.rank };
    }
    bestByClub.set(clubId, entry);
  }

  const scored = Array.from(bestByClub.entries()).map(([clubId, bestRankByAgeGroup]) => {
    const score = computeClubScore(bestRankByAgeGroup);
    return { clubId, ...score };
  });

  const ranked = rankClubs(scored);

  await prisma.$transaction(async (tx) => {
    await tx.clubRankingResult.deleteMany({ where: { seasonId } });

    for (const club of ranked) {
      const result = await tx.clubRankingResult.create({
        data: {
          seasonId,
          clubId: club.clubId,
          totalPoints: club.totalPoints,
          rank: club.rank,
          isQualified: club.isQualified,
          algorithmVersion: ALGORITHM_VERSION,
        },
      });
      await tx.clubRankingResultContribution.createMany({
        data: club.contributions.map((c) => ({
          clubRankingResultId: result.id,
          ageGroup: c.ageGroup,
          teamId: c.teamId,
          rank: c.rank,
          rawPoints: c.rawPoints,
          weightedPoints: c.weightedPoints,
          countedInBest5: c.countedInBest5,
        })),
      });
    }
  });
}
