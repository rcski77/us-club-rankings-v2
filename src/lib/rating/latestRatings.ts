import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
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
 */
export async function getLatestTeamRatings(
  teamIds: string[],
  seasonId: string,
  gender: RankingGender,
  ratingEngine: RatingEngine,
): Promise<LatestRating[]> {
  if (teamIds.length === 0) return [];
  return prisma.$queryRaw<LatestRating[]>`
    SELECT h."teamId", h."rating", h."rank", h."comparisons"
    FROM "TeamRatingHistory" h
    JOIN (
      SELECT "ageGroup", MAX("weekEndingDate") AS latest
      FROM "TeamRatingHistory"
      WHERE "seasonId" = ${seasonId} AND "gender"::text = ${gender} AND "ratingEngine"::text = ${ratingEngine}
      GROUP BY "ageGroup"
    ) l ON l."ageGroup" = h."ageGroup" AND l.latest = h."weekEndingDate"
    WHERE h."seasonId" = ${seasonId} AND h."gender"::text = ${gender} AND h."ratingEngine"::text = ${ratingEngine}
      AND h."teamId" IN (${Prisma.join(teamIds)})`;
}
