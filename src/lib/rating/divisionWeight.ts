/**
 * Maps a division's Colley FSS percentile (see computeDivisionFieldStrength.ts /
 * suggestPointTemplate.ts's computeFssPercentile) to an Elo K-factor multiplier for
 * that division's matches, via an empirical rank transform (quantile normalization)
 * against every other division's percentile currently known in the same
 * (season, ageGroup) partition -- not a fixed floor/ceiling. Deliberately Colley-only,
 * never the Elo/DCI-based percentile computeDivisionScoringSuggestion.ts sometimes
 * uses instead (once >=50% of a division's teams have Elo ratings) -- using an
 * Elo-derived percentile to weight Elo itself would be circular. Colley never reads an
 * Elo rating anywhere (a rank-inferred standings solve, or its own independent batch
 * solve over the same match data Elo replays sequentially), so Colley -> Elo weighting
 * is one-directional.
 *
 * A fixed floor/ceiling (e.g. mapping percentile [0, 95] linearly) was tried first and
 * rejected after checking it against real data (2026-07-28): all 24 real 14u divisions
 * with trustworthy Colley signal spanned percentile 53.3 to 98.1, not 0-100 -- a
 * division needs enough Colley-connected teams to get a trustworthy signal at all (see
 * the LOW_PERCENT_RATED gate in computeMatchDivisionWeights.ts), so almost no real
 * division ever lands below ~50th percentile. That meant a fixed [0, 95] map wasted
 * its entire bottom half on percentiles that essentially never occur -- a division
 * staff scored at only 50 points (clearly meant to be weak) still landed at percentile
 * 71.7 -> weight 1.38, most of the way to the ceiling. Ranking against the *live*
 * population of division percentiles instead is self-calibrating by construction: the
 * weakest division currently known always gets WEIGHT_MIN, the strongest always gets
 * WEIGHT_MAX, evenly spread between, with no floor/ceiling constant to guess or
 * revisit as more of the season's divisions get scored.
 */

/**
 * Weight range -- same rough magnitude as elo.ts's existing marginMultiplier
 * ([0.8, 1.2]), not derived from any formula. Uncalibrated placeholder, same status
 * as every other uncalibrated constant in this rating system (dci.ts's
 * SCALE_REFERENCE_* etc. -- ELO_ELITE_THRESHOLD used to be one of these too, but was
 * replaced 2026-08-04 by a population-relative percentile for exactly the reason noted
 * here: a fixed absolute constant drifts out of calibration as the underlying rating
 * distribution shifts, which this WEIGHT_MIN/MAX pair already avoids by being
 * rank-transform-based rather than a fixed value -- see this file's header comment)
 * -- revisit once more seasons of data exist to check it against.
 */
export const WEIGHT_MIN = 0.7;
export const WEIGHT_MAX = 1.6;

/**
 * `percentile === null` (no trustworthy Colley signal yet -- see the coverage gate in
 * computeMatchDivisionWeights.ts) or fewer than 2 divisions in the population (nothing
 * to rank against yet) map to a neutral 1: "we don't know this division's strength
 * yet" is not the same claim as "this is the weakest possible division."
 *
 * `divisionPercentilePopulation` is every division's own FSS percentile currently
 * known in this (season, ageGroup) partition, including this division's own --
 * ranked (count of population values <= this one), then linearly spread across
 * [WEIGHT_MIN, WEIGHT_MAX] by that rank's fraction of the population.
 */
export function computeDivisionWeight(
  percentile: number | null,
  divisionPercentilePopulation: number[],
): number {
  if (percentile === null || divisionPercentilePopulation.length < 2) return 1;
  const sorted = [...divisionPercentilePopulation].sort((a, b) => a - b);
  const rank = sorted.filter((p) => p <= percentile).length; // 1..n
  const rankFraction = (rank - 1) / (sorted.length - 1);
  return WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * rankFraction;
}
