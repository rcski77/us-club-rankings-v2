import { prisma } from "@/lib/prisma";
import { isBoysTeamCode } from "@/lib/teamGender";

const BEST_N = 3;
const ALGORITHM_VERSION = "phase1-points-only";

/**
 * Recomputes the official points-based ranking for one (season, ageGroup) partition:
 * gather CONFIRMED-division finishes for that age group (or ignoreAge finishes whose
 * TEAM's natural age group -- per that team's TeamSeason row -- matches), sum each
 * team's best 3 point finishes, rank descending, and replace the prior computed set.
 * See plan section 4.3.
 */
export async function computeRanking(seasonId: string, ageGroup: number) {
  // Fetch every CONFIRMED finish within this season's events (not just this age
  // group) because an ignoreAge finish can live in a division of a *different* age
  // group but still count toward this one -- see the `relevant` filter below.
  const finishes = await prisma.teamFinish.findMany({
    where: {
      points: { not: null },
      division: { event: { seasonId }, scoringStatus: "CONFIRMED" },
    },
    include: { division: true },
  });

  // A team's "natural" age group for this season -- needed to resolve ignoreAge
  // finishes, since a team can play up/down in a division of a different age group
  // but should still count toward the age group it's actually enrolled at this season.
  const teamSeasons = await prisma.teamSeason.findMany({ where: { seasonId } });
  const naturalAgeGroup = new Map(teamSeasons.map((ts) => [ts.teamId, ts.ageGroup]));
  // Girls rankings only for now -- boys support is planned but not built (see
  // teamGender.ts). Filtering out boys' finishes here also has the effect of
  // "ignoring" any division that's boys-only (no girls TeamFinish rows to survive
  // the filter), without needing a separate division-level check.
  const boysTeamIds = new Set(
    teamSeasons.filter((ts) => isBoysTeamCode(ts.externalTeamCode)).map((ts) => ts.teamId),
  );

  // A finish counts toward this ageGroup's ranking if either:
  //  - the division itself is this age group (the normal case), or
  //  - ignoreAge is set and the TEAM's natural age group (per its TeamSeason row for
  //    this season) is this one (played up/down but should still count for their own).
  const relevant = finishes.filter(
    (f) =>
      !boysTeamIds.has(f.teamId) &&
      ((f.division.ageGroup === ageGroup && !f.ignoreAge) ||
        (f.ignoreAge && naturalAgeGroup.get(f.teamId) === ageGroup)),
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

    // Bulk-insert every team's result in one round trip (createManyAndReturn hands
    // back the generated ids), then bulk-insert every contribution row in another --
    // a per-team create+createMany loop here was hundreds of sequential round trips
    // for a single age group (600+ teams), which is what made confirm/unlock slow.
    const results = await tx.rankingResult.createManyAndReturn({
      data: ranked.map((t) => ({
        seasonId,
        ageGroup,
        teamId: t.teamId,
        totalPoints: t.totalPoints,
        rank: t.rank,
        weightedRank: t.rank, // phase 1: no NPS/CPI/Ballot blending yet
        algorithmVersion: ALGORITHM_VERSION,
      })),
    });
    const resultIdByTeam = new Map(results.map((r) => [r.teamId, r.id]));

    await tx.rankingResultContribution.createMany({
      data: ranked.flatMap((t) =>
        t.contributions.map((c) => ({ ...c, rankingResultId: resultIdByTeam.get(t.teamId)! })),
      ),
    });
  });
}

/** Recomputes every distinct age group touched by finishes in the given division. */
export async function recomputeRankingsForDivision(divisionId: string) {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true, finishes: true },
  });

  const ageGroups = new Set<number>([division.ageGroup]);

  const ignoreAgeFinishes = division.finishes.filter((f) => f.ignoreAge);
  if (ignoreAgeFinishes.length > 0) {
    const teamSeasons = await prisma.teamSeason.findMany({
      where: {
        seasonId: division.event.seasonId,
        teamId: { in: ignoreAgeFinishes.map((f) => f.teamId) },
      },
    });
    for (const ts of teamSeasons) ageGroups.add(ts.ageGroup);
  }

  for (const ageGroup of ageGroups) {
    await computeRanking(division.event.seasonId, ageGroup);
  }
}
