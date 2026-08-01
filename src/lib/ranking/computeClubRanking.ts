import { prisma } from "@/lib/prisma";
import { computeCombinedRankByTeam } from "@/lib/rating/powerRankings";
import type { ClubRankingSource } from "@/generated/prisma/enums";
import { AGE_GROUPS, computeClubScore, rankClubs, type BestRankByAgeGroup } from "./clubRanking";

const ALGORITHM_VERSION = "phase7-v1";

/** teamId -> rank within one (season, ageGroup), for whichever per-team ranking
 * `source` selects. NPS reads the persisted RankingResult.rank directly; COMBINED
 * reuses the same Combined Rankings blend the team-rankings pages already compute
 * (see computeCombinedRankByTeam) so club rankings never re-derive that math. */
async function getTeamRanksByAgeGroup(
  seasonId: string,
  ageGroup: number,
  source: ClubRankingSource,
): Promise<Map<string, number>> {
  if (source === "COMBINED") {
    return computeCombinedRankByTeam(seasonId, ageGroup);
  }
  const results = await prisma.rankingResult.findMany({
    where: { seasonId, ageGroup },
    select: { teamId: true, rank: true },
  });
  return new Map(results.map((r) => [r.teamId, r.rank]));
}

/**
 * Recomputes the club-level ranking for a whole season (not per age group -- a
 * club's score spans every age group at once, see docs/plan.md §8), for one ranking
 * `source` at a time -- NPS and COMBINED are independent rollups, stored and shown
 * separately, not blended together. §8's "highest-ranked team only per age group"
 * rule makes this a cheap rollup over data the team-level ranking(s) already
 * produced, not a new team-level computation.
 */
export async function computeClubRankingForSeason(seasonId: string, source: ClubRankingSource = "NPS") {
  // For each (club, ageGroup), keep only the club's best-ranked (lowest rank number)
  // team -- §8 point 2: "the club's highest-ranked team only... not all of the
  // club's teams." Sequential per age group (not Promise.all) -- see
  // docs/dev-environment.md.
  const bestByClub = new Map<string, BestRankByAgeGroup>();
  for (const ageGroup of AGE_GROUPS) {
    const ranksByTeam = await getTeamRanksByAgeGroup(seasonId, ageGroup, source);
    if (ranksByTeam.size === 0) continue;

    const teams = await prisma.team.findMany({
      where: { id: { in: [...ranksByTeam.keys()] } },
      select: { id: true, clubId: true },
    });
    for (const team of teams) {
      if (!team.clubId) continue; // unlinked team -- no club to roll up into
      const rank = ranksByTeam.get(team.id)!;
      const entry = bestByClub.get(team.clubId) ?? {};
      const existing = entry[ageGroup];
      if (!existing || rank < existing.rank) {
        entry[ageGroup] = { teamId: team.id, rank };
      }
      bestByClub.set(team.clubId, entry);
    }
  }

  const scored = Array.from(bestByClub.entries()).map(([clubId, bestRankByAgeGroup]) => {
    const score = computeClubScore(bestRankByAgeGroup);
    return { clubId, ...score };
  });

  const ranked = rankClubs(scored);

  await prisma.$transaction(async (tx) => {
    await tx.clubRankingResult.deleteMany({ where: { seasonId, source } });

    for (const club of ranked) {
      const result = await tx.clubRankingResult.create({
        data: {
          seasonId,
          clubId: club.clubId,
          source,
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
