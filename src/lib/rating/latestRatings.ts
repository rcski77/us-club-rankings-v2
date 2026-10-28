import { prisma } from "@/lib/prisma";
import type { RatingEngine } from "@/generated/prisma/enums";
import type { RankingGender } from "@/lib/teamGender";

export type LatestRating = { teamId: string; rating: number; rank: number; comparisons: number };

/**
 * Every team's rating in one (season, ageGroup, gender) partition's latest snapshot --
 * the same rows Power rankings show (see powerRankings.ts). A team only counts if the
 * latest recompute rated it: one that dropped out keeps no stale rating here.
 *
 * Reads exactly one snapshot rather than every snapshot and keeping each team's newest
 * in Node -- TeamRatingHistory keeps one weekly snapshot per partition (see
 * pruneRatingHistory), so "all of it" grows over a season while this stays one
 * snapshot's worth.
 */
export async function getLatestPartitionRatings(
  seasonId: string,
  ageGroup: number,
  gender: RankingGender,
  ratingEngine: RatingEngine,
): Promise<LatestRating[]> {
  const latest = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, gender, ratingEngine },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });
  if (!latest) return [];
  return prisma.teamRatingHistory.findMany({
    where: { seasonId, ageGroup, gender, ratingEngine, weekEndingDate: latest.weekEndingDate },
    select: { teamId: true, rating: true, rank: true, comparisons: true },
  });
}

/**
 * The given teams' ratings from the latest snapshot of whichever (ageGroup) partition
 * each one is rated in, within one season and girls/boys bucket -- for a division's
 * teams, which can span age groups (a team playing up is rated in its own natural age
 * group). Same "latest snapshot only" rule as getLatestPartitionRatings.
 *
 * A team is rated in its natural age group (its TeamSeason row), so only those age
 * groups' latest dates are looked up -- each a single indexed findFirst, rather than a
 * GROUP BY over every snapshot of the season (which cost ~140ms per call on a
 * prod-sized history and ran twice per division in the nightly scoring loop).
 */
export async function getLatestTeamRatings(
  teamIds: string[],
  seasonId: string,
  gender: RankingGender,
  ratingEngine: RatingEngine,
): Promise<LatestRating[]> {
  if (teamIds.length === 0) return [];
  const teamSeasons = await prisma.teamSeason.findMany({
    where: { seasonId, teamId: { in: teamIds } },
    select: { ageGroup: true },
  });
  const ageGroups = [...new Set(teamSeasons.map((ts) => ts.ageGroup))];
  const latest = await Promise.all(
    ageGroups.map((ageGroup) =>
      prisma.teamRatingHistory.findFirst({
        where: { seasonId, ageGroup, gender, ratingEngine },
        orderBy: { weekEndingDate: "desc" },
        select: { ageGroup: true, weekEndingDate: true },
      }),
    ),
  );
  const snapshots = latest.filter((row): row is NonNullable<typeof row> => row !== null);
  if (snapshots.length === 0) return [];

  return prisma.teamRatingHistory.findMany({
    where: {
      teamId: { in: teamIds },
      seasonId,
      gender,
      ratingEngine,
      OR: snapshots.map((s) => ({ ageGroup: s.ageGroup, weekEndingDate: s.weekEndingDate })),
    },
    select: { teamId: true, rating: true, rank: true, comparisons: true },
  });
}
