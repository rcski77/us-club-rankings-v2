// Pure recency-weighted 5-year club ranking logic -- see docs/plan.md's legacy
// 5-year import note. Kept separate from computeFiveYearClubRanking.ts's Prisma
// orchestration so the math is unit-tested without a database, same split as
// clubRanking.ts/computeClubRanking.ts.

// Oldest-to-newest weights, confirmed from the source workbook's own live formulas
// (`5 Year Ranking` sheet: `=Table2[[#This Row],[2021]]*0.05`, ...*0.15/0.20/0.25/0.35
// summed) -- a missing year contributes 0, not a renormalized share (the workbook's
// own per-year lookup is `IFERROR(FILTER(...), 0)`).
export const FIVE_YEAR_WEIGHTS = [0.05, 0.15, 0.2, 0.25, 0.35] as const;

export type FiveYearContribution = {
  year: number;
  weight: number;
  points: number; // 0 when the club had no score that year
  weightedPoints: number;
  present: boolean; // false when defaulted to 0 (no score for that year)
};

export type FiveYearClubScore = {
  totalPoints: number;
  contributions: FiveYearContribution[];
};

/**
 * `years` must be exactly 5 consecutive years, oldest first (e.g. [2021..2025]) --
 * weights are applied positionally, oldest -> lightest, matching FIVE_YEAR_WEIGHTS.
 * `pointsByYear` holds whatever real ClubAnnualScore totals exist; an absent year
 * contributes 0 (see FIVE_YEAR_WEIGHTS' comment) rather than being dropped/
 * renormalized.
 */
export function computeFiveYearClubScore(
  pointsByYear: Partial<Record<number, number>>,
  years: readonly number[],
): FiveYearClubScore {
  if (years.length !== 5) {
    throw new Error(`computeFiveYearClubScore expects exactly 5 years, got ${years.length}`);
  }

  const contributions: FiveYearContribution[] = years.map((year, i) => {
    const raw = pointsByYear[year];
    const present = raw !== undefined;
    const points = present ? raw : 0;
    const weight = FIVE_YEAR_WEIGHTS[i];
    return { year, weight, points, weightedPoints: points * weight, present };
  });

  // Rounded to the 1 decimal place actually displayed -- same float-tie rationale as
  // clubRanking.ts's computeClubScore (binary floating point can leave genuinely-tied
  // totals differing in the 15th decimal digit).
  const rawTotal = contributions.reduce((sum, c) => sum + c.weightedPoints, 0);
  const totalPoints = Math.round(rawTotal * 10) / 10;

  return { totalPoints, contributions };
}

export type RankableFiveYearClub = {
  clubId: string;
  totalPoints: number;
};

/**
 * Standard competition ranking (ties share a rank, next rank skips accordingly) --
 * same tie handling as rankClubs() in clubRanking.ts, but a single tier: the
 * workbook's own `5 Year Ranking` tab has no qualified/under-qualified concept, it's
 * a pure sum-and-sort.
 */
export function rankFiveYearClubs<T extends RankableFiveYearClub>(
  clubs: T[],
): (T & { rank: number })[] {
  const sorted = [...clubs].sort((a, b) => b.totalPoints - a.totalPoints);

  let rank = 0;
  let lastPoints: number | null = null;
  return sorted.map((c, i) => {
    if (lastPoints === null || c.totalPoints !== lastPoints) {
      rank = i + 1;
      lastPoints = c.totalPoints;
    }
    return { ...c, rank };
  });
}
