import { prisma } from "@/lib/prisma";
import { partitionGenderForDivision, type RankingGender } from "@/lib/teamGender";
import { getLatestPartitionRatings, getLatestTeamRatings } from "./latestRatings";

/**
 * The latest Elo rating for each of a division's teams that has one -- the Elo-engine
 * analog of computeDivisionFieldStrength.ts's fetchLatestRatedTeams(), used by
 * computeDivisionScoringSuggestion.ts to decide whether a division has enough Elo data
 * to run the DCI path (see dci.ts) instead of falling back to Colley. A team's rating
 * is looked up by (teamId, seasonId) only, not also ageGroup -- computeEloRatingsForPartition
 * already resolves each team to its natural age-group partition (the ignoreAge case),
 * same as the Colley engine. Only ratings from the division's own girls/boys bucket
 * count -- see computeDivisionFieldStrength.ts's fetchLatestRatedTeams.
 */
export type DivisionEloRating = { teamId: string; rating: number; matchesPlayed: number };

export async function getDivisionEloRatings(divisionId: string): Promise<DivisionEloRating[]> {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true, finishes: true },
  });

  const teamIds = division.finishes.map((f) => f.teamId);
  if (teamIds.length === 0) return [];

  const latest = await getLatestTeamRatings(
    teamIds,
    division.event.seasonId,
    partitionGenderForDivision(division.gender),
    "ELO",
  );
  return latest.map((row) => ({ teamId: row.teamId, rating: row.rating, matchesPlayed: row.comparisons }));
}

/** Every team's Elo rating in a (season, ageGroup, gender)'s latest snapshot -- the population Strength of Field is percentiled against. */
export async function getEloPopulationRatings(
  seasonId: string,
  ageGroup: number,
  gender: RankingGender,
): Promise<number[]> {
  const population = await getLatestPartitionRatings(seasonId, ageGroup, gender, "ELO");
  return population.map((row) => row.rating);
}
