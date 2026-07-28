import { prisma } from "@/lib/prisma";

/**
 * The latest Elo rating for each of a division's teams that has one -- the Elo-engine
 * analog of computeDivisionFieldStrength.ts's fetchLatestRatedTeams(), used by
 * computeDivisionScoringSuggestion.ts to decide whether a division has enough Elo data
 * to run the DCI path (see dci.ts) instead of falling back to Colley. A team's rating
 * is looked up by (teamId, seasonId) only, not also ageGroup -- computeEloRatingsForPartition
 * already resolves each team to its natural age-group partition (the ignoreAge case),
 * same as the Colley engine.
 */
export type DivisionEloRating = { teamId: string; rating: number; matchesPlayed: number };

export async function getDivisionEloRatings(divisionId: string): Promise<DivisionEloRating[]> {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true, finishes: true },
  });

  const teamIds = division.finishes.map((f) => f.teamId);
  if (teamIds.length === 0) return [];

  const history = await prisma.teamRatingHistory.findMany({
    where: { teamId: { in: teamIds }, seasonId: division.event.seasonId, ratingEngine: "ELO" },
    orderBy: { weekEndingDate: "desc" },
  });

  const latestByTeam = new Map<string, DivisionEloRating>();
  for (const row of history) {
    if (!latestByTeam.has(row.teamId)) {
      latestByTeam.set(row.teamId, { teamId: row.teamId, rating: row.rating, matchesPlayed: row.comparisons });
    }
  }
  return Array.from(latestByTeam.values());
}

/** Every team's latest Elo rating across a whole (season, ageGroup) -- the population Strength of Field is percentiled against. */
export async function getEloPopulationRatings(seasonId: string, ageGroup: number): Promise<number[]> {
  const history = await prisma.teamRatingHistory.findMany({
    where: { seasonId, ageGroup, ratingEngine: "ELO" },
    orderBy: { weekEndingDate: "desc" },
  });
  const latestByTeam = new Map<string, number>();
  for (const row of history) {
    if (!latestByTeam.has(row.teamId)) latestByTeam.set(row.teamId, row.rating);
  }
  return Array.from(latestByTeam.values());
}
