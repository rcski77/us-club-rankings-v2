/**
 * Maps a division's FSS to a percentile within its (season, ageGroup) rating
 * population, a plain-language score band, and a suggested PointTemplate. See
 * docs/plan.md §2 "Suggest -> Admin Confirms workflow". Pure math; orchestration
 * (gathering the rating population + template list) lives in
 * computeDivisionScoringSuggestion.ts.
 */

export type ScoreBand = "Elite field" | "Strong regional" | "Solid regional" | "Developmental";

/**
 * Placeholder band cutoffs -- not calibrated against real historical data (see
 * docs/plan.md Open Question 5). Revisit during Phase 4 calibration.
 */
const SCORE_BAND_CUTOFFS: { min: number; band: ScoreBand }[] = [
  { min: 90, band: "Elite field" },
  { min: 70, band: "Strong regional" },
  { min: 40, band: "Solid regional" },
  { min: 0, band: "Developmental" },
];

/**
 * Percentile of `fss` within `populationRatings` (0-100; 100 = strongest possible),
 * expressed as the share of the population's ratings the FSS is greater than or
 * equal to. This is what makes the suggestion self-calibrating against the current
 * live rating distribution rather than a fixed FSS-value cutoff.
 */
export function computeFssPercentile(fss: number, populationRatings: number[]): number | null {
  if (populationRatings.length === 0) return null;
  const atOrBelow = populationRatings.filter((r) => r <= fss).length;
  return (atOrBelow / populationRatings.length) * 100;
}

export function scoreBandForPercentile(percentile: number): ScoreBand {
  return SCORE_BAND_CUTOFFS.find((c) => percentile >= c.min)!.band;
}

export type TemplateOption = { id: string; maxPoints: number };

/**
 * Maps a percentile linearly onto the available (non-anchor) template library,
 * ordered strongest-to-weakest by maxPoints: percentile 100 -> the strongest
 * template, percentile 0 -> the weakest. Exact mapping is a Phase 3 calibration
 * detail (docs/plan.md Open Question 5), but linear-by-percentile is a reasonable
 * self-calibrating default that adapts automatically as the template library grows.
 */
export function suggestTemplate(
  percentile: number,
  templatesDescByMaxPoints: TemplateOption[],
): string | null {
  if (templatesDescByMaxPoints.length === 0) return null;
  const clamped = Math.min(100, Math.max(0, percentile));
  const index = Math.round((1 - clamped / 100) * (templatesDescByMaxPoints.length - 1));
  return templatesDescByMaxPoints[index].id;
}
