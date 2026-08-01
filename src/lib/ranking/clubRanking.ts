// Pure scoring logic for Phase 7 club rankings -- see docs/plan.md §8. Kept separate
// from computeClubRanking.ts's Prisma orchestration so the actual math is unit-tested
// without a database.

export const AGE_GROUPS = [13, 14, 15, 16, 17, 18] as const;
export type ClubAgeGroup = (typeof AGE_GROUPS)[number];

const WEIGHT_PER_AGE_GROUP = 0.2; // flat 20% per age group, all six -- docs/plan.md §8 point 3
const DROP_LOWEST_COUNT = 1; // best 5 of 6 -- docs/plan.md §8 point 4
const QUALIFYING_TOP_N = 100; // "top 100 of the National Rankings," per age group -- §8 point 1
const MIN_QUALIFYING_AGE_GROUPS = 3; // §8 point 1

export type AgeGroupContribution = {
  ageGroup: ClubAgeGroup;
  teamId: string | null;
  rank: number | null;
  rawPoints: number | null; // 101 - rank; null when the club has no team in this age group
  weightedPoints: number | null; // rawPoints * 0.20
  countedInBest5: boolean;
};

export type ClubScore = {
  totalPoints: number;
  isQualified: boolean;
  contributions: AgeGroupContribution[];
};

/**
 * A club's best-ranked team's `RankingResult.rank` per age group it has one for.
 * Absent age groups (no ranked team) are simply missing keys -- see computeClubScore
 * for how that's treated as an implicit zero-scoring slot.
 */
export type BestRankByAgeGroup = Partial<Record<ClubAgeGroup, { teamId: string; rank: number }>>;

/** rank -> points, strictly linear, no floor. Ties already share a rank value coming
 * out of RankingResult (see computeRanking.ts's competition-ranking logic), so ties
 * naturally share the same point value here too -- no separate tie handling needed. */
export function rankToPoints(rank: number): number {
  return 101 - rank;
}

export function computeClubScore(bestRankByAgeGroup: BestRankByAgeGroup): ClubScore {
  const isQualified =
    AGE_GROUPS.filter((ag) => {
      const entry = bestRankByAgeGroup[ag];
      return entry !== undefined && entry.rank <= QUALIFYING_TOP_N;
    }).length >= MIN_QUALIFYING_AGE_GROUPS;

  // Every one of the six age groups gets a slot -- an age group with no ranked team
  // is a real 0, not an absence, since "sum best 5 of 6" always drops exactly one
  // slot and a missing age group should be the one dropped first if nothing else is
  // weaker (docs/plan.md §8 point 4).
  const slots = AGE_GROUPS.map((ageGroup) => {
    const entry = bestRankByAgeGroup[ageGroup];
    if (!entry) {
      return { ageGroup, teamId: null, rank: null, rawPoints: null, weightedPoints: 0 };
    }
    const rawPoints = rankToPoints(entry.rank);
    return {
      ageGroup,
      teamId: entry.teamId,
      rank: entry.rank,
      rawPoints,
      weightedPoints: rawPoints * WEIGHT_PER_AGE_GROUP,
    };
  });

  // Drop the single lowest-weighted slot(s); ties for lowest are broken by original
  // age-group order (stable sort), which just needs to be deterministic, not any
  // particular order -- the spec doesn't distinguish among equally-lowest slots.
  const sortedByWeighted = [...slots].sort((a, b) => a.weightedPoints - b.weightedPoints);
  const droppedIds = new Set(sortedByWeighted.slice(0, DROP_LOWEST_COUNT).map((s) => s.ageGroup));

  const contributions: AgeGroupContribution[] = slots.map((s) => ({
    ageGroup: s.ageGroup,
    teamId: s.teamId,
    rank: s.rank,
    rawPoints: s.rawPoints,
    weightedPoints: s.teamId ? s.weightedPoints : null,
    countedInBest5: !droppedIds.has(s.ageGroup),
  }));

  const totalPoints = contributions
    .filter((c) => c.countedInBest5)
    .reduce((sum, c) => sum + (c.weightedPoints ?? 0), 0);

  return { totalPoints, isQualified, contributions };
}

export type RankableClub = {
  clubId: string;
  totalPoints: number;
  isQualified: boolean;
};

/**
 * Two-tier sort: every qualified club (by score, descending) before every
 * under-qualified club (by score, descending) -- docs/plan.md §8 point 1. `rank` is
 * a single continuous position across both tiers (1, 2, 3, ... through the qualified
 * group, then continuing through the under-qualified group), matching how
 * RankingResult.rank is a single sequence rather than restarting per group.
 */
export function rankClubs<T extends RankableClub>(clubs: T[]): (T & { rank: number })[] {
  const qualified = clubs.filter((c) => c.isQualified).sort((a, b) => b.totalPoints - a.totalPoints);
  const underQualified = clubs.filter((c) => !c.isQualified).sort((a, b) => b.totalPoints - a.totalPoints);
  return [...qualified, ...underQualified].map((c, i) => ({ ...c, rank: i + 1 }));
}
