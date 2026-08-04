/**
 * Maps a division's FSS to a percentile within its (season, ageGroup) rating
 * population, a plain-language score band, and a suggested PointTemplate. See
 * docs/plan.md §2 "Suggest -> Admin Confirms workflow". Pure math; orchestration
 * (gathering the rating population + template list) lives in
 * computeDivisionScoringSuggestion.ts.
 */

export type ScoreBand = "Elite field" | "National" | "Strong regional" | "Solid regional" | "Developmental";

/**
 * Placeholder band cutoffs -- not calibrated against real historical data (see
 * docs/plan.md Open Question 5). Revisit during Phase 4 calibration.
 *
 * "National" sits between "Strong regional" and "Elite field": a good national-caliber
 * event (e.g. a Triple Crown NIT bracket or a USAV Open Nationals division that isn't
 * quite top-of-field) rather than a merely strong regional one, but reserved for actual
 * marquee national events -- not the every-bracket ceiling "Elite field" is meant to be.
 */
const SCORE_BAND_CUTOFFS: { min: number; band: ScoreBand }[] = [
  { min: 90, band: "Elite field" },
  { min: 80, band: "National" },
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

/**
 * Placeholder blend weight -- not calibrated against real historical data (see
 * docs/plan.md Open Question 5). Revisit during Phase 4 calibration.
 */
export const ELITE_PRESENCE_BLEND_WEIGHT = 0.5;

/**
 * Blends the raw FSS percentile with Elite Presence % (see fieldStrength.ts) into the
 * effective score that drives scoreBandForPercentile()/suggestTemplate() -- this is
 * what lets a large-but-truly-elite field (e.g. Triple Crown NIT) rate as strong even
 * though its FSS alone, diluted by field depth, would not. Falls back to the raw FSS
 * percentile when elitePresence is null (no elite teams in the population yet), since
 * there's nothing to blend.
 */
export function blendPercentileWithElitePresence(
  fssPercentile: number,
  elitePresence: number | null,
  weight: number = ELITE_PRESENCE_BLEND_WEIGHT,
): number {
  if (elitePresence === null) return fssPercentile;
  return fssPercentile * (1 - weight) + elitePresence * weight;
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
