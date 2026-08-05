/**
 * Bins a division's rated-team Colley ratings into a fixed-width histogram, for the
 * scoring-review screen's distribution chart -- see docs/plan.md §2's "Colley-rating
 * distribution histogram" presentation aid. Pure math, mirrors the colley.ts /
 * fieldStrength.ts split; Prisma orchestration (fetching the ratings) lives alongside
 * computeDivisionFieldStrength.ts.
 *
 * Optionally bins a `subset` (e.g. the current division's ratings) against the same
 * bin edges as the main `ratings` population, so the chart can show where the subset
 * falls within the full distribution rather than just its own shape.
 */

export type HistogramBin = {
  rangeStart: number;
  rangeEnd: number;
  count: number;
  subsetCount: number;
};

export type RatingHistogram = {
  bins: HistogramBin[];
  min: number;
  max: number;
};

const DEFAULT_BIN_COUNT = 10;

/**
 * Splits [min, max] of `ratings` into `binCount` equal-width bins and counts how many
 * ratings fall in each. A single distinct rating value (or an empty list) produces one
 * bin spanning that value (or [0, 0]) rather than dividing by zero. If `subset` is
 * given, its values are counted into the same bin edges (clamped to [min, max], in
 * case a subset value falls outside the population's range) as `subsetCount`.
 */
export function computeRatingHistogram(
  ratings: number[],
  binCount: number = DEFAULT_BIN_COUNT,
  subset?: number[],
): RatingHistogram {
  if (ratings.length === 0) {
    return { bins: [{ rangeStart: 0, rangeEnd: 0, count: 0, subsetCount: 0 }], min: 0, max: 0 };
  }

  const min = Math.min(...ratings);
  const max = Math.max(...ratings);

  if (min === max) {
    return {
      bins: [{ rangeStart: min, rangeEnd: max, count: ratings.length, subsetCount: subset?.length ?? 0 }],
      min,
      max,
    };
  }

  const width = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    rangeStart: min + i * width,
    rangeEnd: min + (i + 1) * width,
    count: 0,
    subsetCount: 0,
  }));

  const binIndexFor = (value: number) => {
    const clamped = Math.min(Math.max(value, min), max);
    // Top edge belongs to the last bin rather than overflowing into a phantom (binCount+1)th bin.
    return clamped === max ? binCount - 1 : Math.floor((clamped - min) / width);
  };

  for (const rating of ratings) bins[binIndexFor(rating)].count += 1;
  for (const rating of subset ?? []) bins[binIndexFor(rating)].subsetCount += 1;

  return { bins, min, max };
}
