import { prisma } from "@/lib/prisma";

const BEST_N = 3;
const ALGORITHM_VERSION = "phase1-points-only";

/**
 * Recomputes the official points-based ranking for one (season, ageGroup) partition:
 * gather CONFIRMED-division finishes for that age group (or ignoreAge finishes whose
 * TEAM's natural age group matches), sum each team's best 3 point finishes, rank
 * descending, and replace the prior computed set. See plan section 4.3.
 */
export async function computeRanking(seasonId: string, ageGroup: number) {
  // Fetch every CONFIRMED finish for the season (not just this age group) because an
  // ignoreAge finish can live in a division of a *different* age group but still
  // count toward this one -- see the `relevant` filter below.
  const finishes = await prisma.teamFinish.findMany({
    where: {
      points: { not: null },
      team: { seasonId },
      division: { event: { seasonId }, scoringStatus: "CONFIRMED" },
    },
    include: { team: true, division: true },
  });

  // A finish counts toward this ageGroup's ranking if either:
  //  - the division itself is this age group (the normal case), or
  //  - ignoreAge is set and the TEAM's natural age group is this one (played up/down
  //    but should still count for their own age group).
  const relevant = finishes.filter(
    (f) =>
      (f.division.ageGroup === ageGroup && !f.ignoreAge) ||
      (f.ignoreAge && f.team.ageGroup === ageGroup),
  );

  const byTeam = new Map<string, typeof relevant>();
  for (const finish of relevant) {
    const list = byTeam.get(finish.teamId) ?? [];
    list.push(finish);
    byTeam.set(finish.teamId, list);
  }

  type TeamTotal = {
    teamId: string;
    totalPoints: number;
    contributions: { teamFinishId: string; points: number; rankInSeason: number; countedInTop3: boolean }[];
  };

  const totals: TeamTotal[] = [];
  for (const [teamId, teamFinishes] of byTeam) {
    const sorted = [...teamFinishes].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    const contributions = sorted.map((f, i) => ({
      teamFinishId: f.id,
      points: f.points ?? 0,
      rankInSeason: i + 1,
      countedInTop3: i < BEST_N,
    }));
    const totalPoints = contributions
      .filter((c) => c.countedInTop3)
      .reduce((sum, c) => sum + c.points, 0);
    totals.push({ teamId, totalPoints, contributions });
  }

  totals.sort((a, b) => b.totalPoints - a.totalPoints);

  // Standard competition ranking: ties share a rank, the next rank skips accordingly.
  let rank = 0;
  let lastPoints: number | null = null;
  const ranked = totals.map((t, i) => {
    if (t.totalPoints !== lastPoints) {
      rank = i + 1;
      lastPoints = t.totalPoints;
    }
    return { ...t, rank };
  });

  await prisma.$transaction(async (tx) => {
    await tx.rankingResult.deleteMany({ where: { seasonId, ageGroup } });

    for (const t of ranked) {
      const result = await tx.rankingResult.create({
        data: {
          seasonId,
          ageGroup,
          teamId: t.teamId,
          totalPoints: t.totalPoints,
          rank: t.rank,
          weightedRank: t.rank, // phase 1: no NPS/CPI/Ballot blending yet
          algorithmVersion: ALGORITHM_VERSION,
        },
      });
      await tx.rankingResultContribution.createMany({
        data: t.contributions.map((c) => ({ ...c, rankingResultId: result.id })),
      });
    }
  });
}

/** Recomputes every distinct age group touched by finishes in the given division. */
export async function recomputeRankingsForDivision(divisionId: string) {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true, finishes: { include: { team: true } } },
  });

  const ageGroups = new Set<number>([division.ageGroup]);
  for (const finish of division.finishes) {
    if (finish.ignoreAge) ageGroups.add(finish.team.ageGroup);
  }

  for (const ageGroup of ageGroups) {
    await computeRanking(division.event.seasonId, ageGroup);
  }
}
