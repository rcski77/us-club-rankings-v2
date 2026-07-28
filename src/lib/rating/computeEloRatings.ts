import { prisma } from "@/lib/prisma";
import {
  buildEloMatches,
  computeEloHistory,
  computeEloRatings as solveElo,
  explainEloChange,
} from "./elo";

/**
 * Gathers the same match set computeEloRatingsForPartition() rates from -- every
 * completed Match belonging to a division that has a relevant (natural-age-group)
 * TeamFinish in this (season, ageGroup) partition, up to asOfDate. Factored out so
 * getTeamEloHistory() can replay the identical graph a team's rating actually came
 * from, not a narrower "just this team's matches" slice (Elo's replay is
 * order/graph-dependent -- see elo.ts).
 */
async function getPartitionMatches(seasonId: string, ageGroup: number, asOfDate: Date) {
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

  const divisionIds = Array.from(new Set(relevant.map((f) => f.divisionId)));
  if (!divisionIds.length) return [];

  return prisma.match.findMany({
    where: {
      divisionId: { in: divisionIds },
      winnerTeamId: { not: null },
      matchDate: { not: null, lte: asOfDate },
    },
    include: {
      event: true,
      division: true,
      teamA: { include: { club: true } },
      teamB: { include: { club: true } },
    },
  });
}

/**
 * Recomputes Elo ratings for one (season, ageGroup) partition as of asOfDate, and
 * persists a weekly TeamRatingHistory snapshot dated weekEndingDate, mirroring
 * computeColleyRatings()'s delete-and-replace-by-partition pattern and its ignoreAge
 * resolution (a finish's division counts toward the team's natural age group, per
 * that season's TeamSeason row -- see computeColleyRatings.ts for why).
 *
 * Unlike Colley, Elo has no standings-inferred fallback: it only exists once
 * match-level data does (docs/plan.md Phase 5, "Tier 2"), so a division that only has
 * finish ranks (no imported Match rows) contributes nothing here. Its replay is also
 * path-dependent (see elo.ts), so a full recompute always replays every eligible match
 * from scratch up to asOfDate rather than applying an incremental delta on top of a
 * prior snapshot.
 */
export async function computeEloRatingsForPartition(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  weekEndingDate: Date,
) {
  const matches = await getPartitionMatches(seasonId, ageGroup, asOfDate);
  const eloMatches = buildEloMatches(matches);
  const ratings = solveElo(eloMatches);

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
      where: { seasonId, ageGroup, weekEndingDate, ratingEngine: "ELO" },
    });
    for (const r of ranked) {
      await tx.teamRatingHistory.create({
        data: {
          teamId: r.teamId,
          seasonId,
          ageGroup,
          weekEndingDate,
          ratingEngine: "ELO",
          rating: r.rating,
          rank: r.rank,
          comparisons: r.matchesPlayed,
        },
      });
    }
  });

  return ranked;
}

/** Recomputes Elo ratings for every distinct ageGroup with a TeamSeason row this season. */
export async function computeEloRatingsForSeason(
  seasonId: string,
  asOfDate: Date = new Date(),
  weekEndingDate: Date = new Date(),
) {
  const teamSeasons = await prisma.teamSeason.findMany({
    where: { seasonId },
    select: { ageGroup: true },
    distinct: ["ageGroup"],
  });

  const results = new Map<number, Awaited<ReturnType<typeof computeEloRatingsForPartition>>>();
  for (const { ageGroup } of teamSeasons) {
    const ranked = await computeEloRatingsForPartition(seasonId, ageGroup, asOfDate, weekEndingDate);
    results.set(ageGroup, ranked);
  }
  return results;
}

export type TeamEloHistoryEntry = {
  matchId: string;
  matchDate: Date;
  eventId: string;
  eventName: string;
  divisionName: string | null;
  opponentTeamId: string;
  opponentName: string;
  opponentClubName: string | null;
  won: boolean;
  thisTeamSets: number;
  opponentSets: number;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  opponentRatingBefore: number;
  expected: number; // this team's win probability going into the match
  k: number;
  multiplier: number;
  explanation: string;
};

/**
 * A team's full Elo match history within one season, most recent first -- replays the
 * same match graph its current rating came from (see getPartitionMatches above), then
 * slices out just the steps involving this team and reorients each one from "team
 * A/B" into "this team vs. opponent". Returns [] for a team with no TeamSeason row
 * for the season (no natural age group to resolve the partition from) or no rated
 * matches yet.
 */
export async function getTeamEloHistory(
  teamId: string,
  seasonId: string,
  asOfDate: Date = new Date(),
): Promise<TeamEloHistoryEntry[]> {
  const teamSeason = await prisma.teamSeason.findUnique({
    where: { teamId_seasonId: { teamId, seasonId } },
  });
  if (!teamSeason) return [];

  const matches = await getPartitionMatches(seasonId, teamSeason.ageGroup, asOfDate);
  const byId = new Map(matches.map((m) => [m.id, m]));

  const steps = computeEloHistory(buildEloMatches(matches));
  const teamSteps = steps.filter((s) => s.teamAId === teamId || s.teamBId === teamId);

  const entries: TeamEloHistoryEntry[] = teamSteps.map((s) => {
    const match = byId.get(s.matchId)!;
    const isA = s.teamAId === teamId;
    const opponent = isA ? match.teamB : match.teamA;

    const ratingBefore = isA ? s.ratingABefore : s.ratingBBefore;
    const ratingAfter = isA ? s.ratingAAfter : s.ratingBAfter;
    const opponentRatingBefore = isA ? s.ratingBBefore : s.ratingABefore;
    const expected = isA ? s.expectedA : 1 - s.expectedA;
    const k = isA ? s.kA : s.kB;
    const won = s.winnerTeamId === teamId;

    return {
      matchId: s.matchId,
      matchDate: s.matchDate,
      eventId: match.eventId,
      eventName: match.event.name,
      divisionName: match.division?.name ?? null,
      opponentTeamId: opponent?.id ?? "",
      opponentName: opponent?.name ?? "(unresolved)",
      opponentClubName: opponent?.club?.name ?? null,
      won,
      thisTeamSets: isA ? s.setsA : s.setsB,
      opponentSets: isA ? s.setsB : s.setsA,
      ratingBefore,
      ratingAfter,
      delta: ratingAfter - ratingBefore,
      opponentRatingBefore,
      expected,
      k,
      multiplier: s.multiplier,
      explanation: explainEloChange({ won, expected, multiplier: s.multiplier }),
    };
  });

  return entries.sort((a, b) => b.matchDate.getTime() - a.matchDate.getTime());
}
