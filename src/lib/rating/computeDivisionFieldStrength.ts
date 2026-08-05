import { prisma } from "@/lib/prisma";
import { computeFieldStrength, type FieldStrengthResult } from "./fieldStrength";

/**
 * Gathers the latest Colley rating for each team entered in a division and runs
 * computeFieldStrength on it. A team's rating is looked up by (teamId, seasonId) only,
 * not also ageGroup: computeColleyRatings already resolves each team to its natural
 * age-group partition (the ignoreAge case), so a team has at most one current COLLEY
 * row per season regardless of which age group's division it's finishing in here.
 */
async function fetchLatestRatedTeams(divisionId: string) {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true, finishes: true },
  });

  const teamIds = division.finishes.map((f) => f.teamId);

  const history = await prisma.teamRatingHistory.findMany({
    where: {
      teamId: { in: teamIds },
      seasonId: division.event.seasonId,
      ratingEngine: "COLLEY",
    },
    orderBy: { weekEndingDate: "desc" },
  });

  const latestByTeam = new Map<string, (typeof history)[number]>();
  for (const row of history) {
    if (!latestByTeam.has(row.teamId)) latestByTeam.set(row.teamId, row);
  }

  const ratedTeams = teamIds
    .map((teamId) => latestByTeam.get(teamId))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      teamId: row.teamId,
      nationalRank: row.rank,
      rating: row.rating,
      comparisons: row.comparisons,
    }));

  return { teamCount: teamIds.length, ratedTeams };
}

export async function computeDivisionFieldStrength(divisionId: string): Promise<FieldStrengthResult> {
  const { teamCount, ratedTeams } = await fetchLatestRatedTeams(divisionId);
  return computeFieldStrength(teamCount, ratedTeams);
}

/**
 * The raw rated-team ratings for a division, for the scoring-review screen's Colley-
 * rating distribution histogram (docs/plan.md §2) -- FieldStrengthResult only carries
 * the aggregated FSS, not the underlying values a histogram needs.
 */
export async function getDivisionRatedRatings(divisionId: string): Promise<number[]> {
  const { ratedTeams } = await fetchLatestRatedTeams(divisionId);
  return ratedTeams.map((t) => t.rating);
}

/**
 * The full (season, ageGroup) Colley rating population -- one rating per team, its
 * latest by week. Mirrors the population query computeDivisionScoringSuggestion.ts
 * uses for percentile calibration; reused here so the scoring-review screen's
 * histogram can show where a division's own ratings fall within that same population
 * instead of just the division's own (much narrower) range.
 */
export async function getSeasonColleyRatingPopulation(
  seasonId: string,
  ageGroup: number,
): Promise<number[]> {
  const population = await prisma.teamRatingHistory.findMany({
    where: { seasonId, ageGroup, ratingEngine: "COLLEY" },
    orderBy: { weekEndingDate: "desc" },
  });
  const latestByTeam = new Map<string, number>();
  for (const row of population) {
    if (!latestByTeam.has(row.teamId)) latestByTeam.set(row.teamId, row.rating);
  }
  return Array.from(latestByTeam.values());
}
