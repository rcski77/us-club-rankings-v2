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
  qualifyingAgeGroupCount: number; // count of age groups with a team ranked in that
  // age group's own top 100 -- 3+ makes isQualified true, but also used to order
  // under-qualified clubs among themselves (a club with 2 such age groups ranks
  // above one with only 1, before either falls back to raw score -- see rankClubs).
  contributions: AgeGroupContribution[];
};

/**
 * A club's best-ranked team's `RankingResult.rank` per age group it has one for.
 * Absent age groups (no ranked team) are simply missing keys -- see computeClubScore
 * for how that's treated as an implicit zero-scoring slot.
 */
export type BestRankByAgeGroup = Partial<Record<ClubAgeGroup, { teamId: string; rank: number }>>;

/** rank -> points, strictly linear from 1st (100) down to 100th (1), floored at 0
 * for any rank outside the top 100 -- a team ranked 101st or worse contributes
 * nothing to its club's score rather than a negative number (by explicit user
 * decision; the legacy site's own "no floor" wording was ambiguous about ranks this
 * far outside the top 100, since the linear scale was really describing the
 * qualifying range). Ties already share a rank value coming out of RankingResult
 * (see computeRanking.ts's competition-ranking logic), so ties naturally share the
 * same point value here too -- no separate tie handling needed. */
export function rankToPoints(rank: number): number {
  return Math.max(0, 101 - rank);
}

export function computeClubScore(bestRankByAgeGroup: BestRankByAgeGroup): ClubScore {
  const qualifyingAgeGroupCount = AGE_GROUPS.filter((ag) => {
    const entry = bestRankByAgeGroup[ag];
    return entry !== undefined && entry.rank <= QUALIFYING_TOP_N;
  }).length;
  const isQualified = qualifyingAgeGroupCount >= MIN_QUALIFYING_AGE_GROUPS;

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

  // Drop the single lowest-weighted slot(s); ties for lowest (e.g. two teams both
  // ranked outside the top 100, so both floored to 0 weighted points) are broken by
  // actual rank, worst-ranked first -- otherwise a stable sort on age-group order
  // could "drop" a 132nd-ranked team while displaying a 226th-ranked team as
  // counting, which is technically equivalent (both score 0) but looks wrong. A
  // missing team (rank null) is treated as worse than any ranked team, so it's
  // preferred for dropping over an actually-ranked-but-non-qualifying team.
  const sortedByWeighted = [...slots].sort((a, b) => {
    if (a.weightedPoints !== b.weightedPoints) return a.weightedPoints - b.weightedPoints;
    return (b.rank ?? Infinity) - (a.rank ?? Infinity);
  });
  const droppedIds = new Set(sortedByWeighted.slice(0, DROP_LOWEST_COUNT).map((s) => s.ageGroup));

  const contributions: AgeGroupContribution[] = slots.map((s) => ({
    ageGroup: s.ageGroup,
    teamId: s.teamId,
    rank: s.rank,
    rawPoints: s.rawPoints,
    weightedPoints: s.teamId ? s.weightedPoints : null,
    countedInBest5: !droppedIds.has(s.ageGroup),
  }));

  const rawTotal = contributions
    .filter((c) => c.countedInBest5)
    .reduce((sum, c) => sum + (c.weightedPoints ?? 0), 0);
  // Rounded to the 1 decimal place actually displayed -- summing rawPoints * 0.2
  // (binary floating point) can leave clubs that are really tied differing in the
  // 15th decimal digit (e.g. 92.60000000000001 vs 92.59999999999999), which both
  // display as "92.6" but compare unequal, so rankClubs's tie detection silently
  // misses them. Rounding here (not just at display time) keeps the stored value and
  // every downstream sort/tie-break consistent with what's shown.
  const totalPoints = Math.round(rawTotal * 10) / 10;

  return { totalPoints, isQualified, qualifyingAgeGroupCount, contributions };
}

export type RankableClub = {
  clubId: string;
  totalPoints: number;
  isQualified: boolean;
  qualifyingAgeGroupCount: number;
};

/**
 * Two-tier sort: every qualified club before every under-qualified club --
 * docs/plan.md §8 point 1. Within the qualified tier, every club has the same
 * qualifyingAgeGroupCount floor (3+) so score alone orders them; within the
 * under-qualified tier, a club with 2 top-100 age groups ranks above one with only
 * 1 (and 1 above 0), score breaking ties within the same count -- not a design-doc
 * requirement, but a natural extension of the same "more qualifying age groups is
 * better" principle §8 already applies at the 3-team threshold. `rank` is a single
 * continuous position across both tiers (1, 2, 3, ... through qualified, then
 * continuing through under-qualified), matching how RankingResult.rank is a single
 * sequence rather than restarting per group. Standard competition ranking within
 * that sequence: clubs tied on the sort key share a rank and the next rank skips
 * accordingly (same tie handling as computeRanking.ts at the team level), so e.g.
 * three clubs tied for 3rd are all shown as 3rd and the next club is 6th.
 */
export function rankClubs<T extends RankableClub>(clubs: T[]): (T & { rank: number })[] {
  const byCountThenScore = (a: T, b: T) =>
    b.qualifyingAgeGroupCount - a.qualifyingAgeGroupCount || b.totalPoints - a.totalPoints;
  const qualified = clubs.filter((c) => c.isQualified).sort((a, b) => b.totalPoints - a.totalPoints);
  const underQualified = clubs.filter((c) => !c.isQualified).sort(byCountThenScore);
  const ordered = [...qualified, ...underQualified];

  let rank = 0;
  let lastKey: string | null = null;
  return ordered.map((c, i) => {
    const key = `${c.isQualified}:${c.qualifyingAgeGroupCount}:${c.totalPoints}`;
    if (key !== lastKey) {
      rank = i + 1;
      lastKey = key;
    }
    return { ...c, rank };
  });
}
