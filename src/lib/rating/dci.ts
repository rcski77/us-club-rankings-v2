/**
 * Division Competitiveness Index (DCI) -- an Elo-based alternative to the Colley
 * FSS/elitePresence blend, modeled on VolleyLens' published "Tournament
 * Competitiveness Index" methodology (Elite Presence 40% / Strength of Field 25% /
 * Scale Factor 35%). Used in place of the Colley-based blend for a division once its
 * teams have Elo ratings (i.e. imported Match data) -- see computeDivisionScoringSuggestion.ts
 * for the per-division fallback to the Colley path when they don't (Elo has no
 * standings-inferred fallback of its own, per elo.ts).
 *
 * The scale-factor reference points below are explicitly uncalibrated -- picked from a
 * one-time look at this project's actual current data, not from any established
 * formula, and expected to need revisiting as more seasons of match data accumulate.
 * The elite threshold (see computeEliteThreshold() below) is not a fixed placeholder
 * of that kind -- see its own comment for why.
 */

export const DCI_WEIGHTS = { elitePresence: 0.4, strengthOfField: 0.25, scaleFactor: 0.35 } as const;

/**
 * Minimum share of a division's teams that must have an Elo rating before the DCI
 * (Elo) path is trusted over the Colley fallback -- without this, a division with
 * just a handful of incidentally-rated teams (e.g. 3 of 64) would have its DCI
 * computed from an unrepresentative sample and silently override the far more
 * complete Colley/standings signal. Matches fieldStrength.ts's LOW_PERCENT_RATED
 * warning bar for the same "half the field isn't enough signal" reasoning.
 */
export const ELO_COVERAGE_THRESHOLD = 0.5;

/**
 * The percentile (within the current Elo population) that "elite" tracks -- see
 * computeEliteThreshold() below for how this becomes an actual rating value.
 *
 * History: originally a fixed absolute rating (1450, picked 2026-07-30 from a one-time
 * look at real 14u data; see git history for that reasoning). That went stale one
 * session after Elo's own tuning constants were recalibrated (2026-08-03, see
 * docs/plan.md's Status entries): recalibration widened Elo's spread from the 1500
 * default, silently moving the whole rated population upward relative to the fixed
 * number -- prod data (2026-08-04) showed the population median landing almost
 * exactly on 1450, with 18% of Elo-eligible divisions pinned at exactly 100% Elite
 * Presence. Re-picking a new fixed number (1633, checked the same way 1450 was) fixed
 * the symptom but not the underlying fragility -- the same drift would recur the next
 * time Elo's constants change. This constant is the fix for the actual cause: instead
 * of a fixed rating, track a fixed *percentile* of the live population, so the
 * resulting rating value moves automatically as the population's own scale shifts.
 *
 * A population-relative cutoff was explicitly rejected once before (Phase 5) on the
 * reasoning that Elite Presence is intrinsic to a division's own roster, not the
 * population, and a threshold only a small percentile clears would make even the
 * single strongest field in the country look weak -- real data at the time showed
 * Triple Crown NIT 14 Open at just 15% Elite Presence under a *top 8-13% nationally*
 * cutoff. That data point doesn't actually contradict this constant: 75 is a much less
 * extreme percentile than the top 8-13% that was tried and rejected, and this exact
 * value was checked the same way 1633 was (division-level clustering at the 0%/100%
 * extremes, plus a named-division sanity check against real prod data) -- Triple Crown
 * NIT / USAV Girls Junior National Championship divisions land 91-100%, explicitly
 * lower-tier ("Club"/"Classic") named divisions land 0-3%. The earlier rejection holds
 * as a caution against picking too strict a percentile, not against this approach in
 * general. Revisit with `prisma/analyzeEliteThreshold.ts` (`npm run
 * analyze:elite-threshold`) if that gap ever looks wrong again -- the script's sweep is
 * now over candidate percentiles, not raw rating values, matching this constant.
 */
export const ELITE_PERCENTILE = 75;

/**
 * The Elo rating at ELITE_PERCENTILE within `populationRatings` -- turns the
 * population-relative knob above into the actual absolute rating value
 * computeIntrinsicElitePresence() needs. Null for an empty population (nothing to
 * derive a threshold from). Same "share of the population at or below" percentile
 * convention as suggestPointTemplate.ts's computeFssPercentile(), just inverted
 * (rating-from-percentile here, vs. percentile-from-rating there).
 */
export function computeEliteThreshold(
  populationRatings: number[],
  percentile: number = ELITE_PERCENTILE,
): number | null {
  if (populationRatings.length === 0) return null;
  const sorted = [...populationRatings].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length));
  return sorted[index];
}

/**
 * % of this division's own Elo-rated teams at or above `threshold` -- deliberately
 * intrinsic to the division (no external population denominator, unlike the Colley
 * elitePresence metric), so it doesn't depend on how much of the season's data existed
 * the moment this division's snapshot happened to be generated. `threshold` is
 * required, not defaulted: callers should derive it from the current population via
 * computeEliteThreshold() (see computeDivisionScoringSuggestion.ts) rather than rely on
 * an implicit constant that can silently drift out of calibration -- exactly what
 * happened to the fixed threshold this replaced (see ELITE_PERCENTILE's comment).
 */
export function computeIntrinsicElitePresence(ratings: number[], threshold: number): number {
  if (ratings.length === 0) return 0;
  const eliteCount = ratings.filter((r) => r >= threshold).length;
  return (eliteCount / ratings.length) * 100;
}

/** Mean Elo of the top quartile (by rating) -- DCI's Strength of Field input. */
export function computeTopQuartileMean(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const sorted = [...ratings].sort((a, b) => b - a);
  // Round up so a small field (e.g. 1-3 rated teams) still yields a non-empty quartile.
  const topQuartileCount = Math.ceil(sorted.length / 4);
  const topQuartile = sorted.slice(0, topQuartileCount);
  return topQuartile.reduce((sum, r) => sum + r, 0) / topQuartile.length;
}

/**
 * "Fully scaled" reference points -- team count / match volume at or above these are
 * treated as maximally scaled (100). Checked (not just guessed) against this project's
 * real division data: across the 69 divisions currently eligible for the DCI path, a
 * standard 48-team USAV bracket (the most common division size) scores ~48-55/100 on
 * each, and only the handful of genuinely huge fields -- Triple Crown NIT's combined
 * single-age brackets, 100-163 teams / 1500-2900 matches -- approach the 100 cap. The
 * two references sit at slightly different rarity (~100 teams clears for ~6% of
 * divisions, ~1000 matches for ~14%) but that gap was reviewed and judged not worth
 * tightening without more seasons of data to calibrate against.
 */
const SCALE_REFERENCE_TEAM_COUNT = 100;
const SCALE_REFERENCE_MATCH_VOLUME = 1000;

/** Normalizes team count + match volume into a 0-100 scale factor. */
export function computeScaleFactor(teamCount: number, matchVolume: number): number {
  const teamScore = Math.min(100, (teamCount / SCALE_REFERENCE_TEAM_COUNT) * 100);
  const matchScore = Math.min(100, (matchVolume / SCALE_REFERENCE_MATCH_VOLUME) * 100);
  return (teamScore + matchScore) / 2;
}

/**
 * Blends the three 0-100 DCI components at DCI_WEIGHTS into the effective score that
 * drives scoreBandForPercentile()/suggestTemplate() -- the Elo-path equivalent of
 * suggestPointTemplate.ts's blendPercentileWithElitePresence().
 */
export function computeDci(
  elitePresence: number,
  strengthOfFieldPercentile: number,
  scaleFactor: number,
  weights: { elitePresence: number; strengthOfField: number; scaleFactor: number } = DCI_WEIGHTS,
): number {
  return (
    weights.elitePresence * elitePresence +
    weights.strengthOfField * strengthOfFieldPercentile +
    weights.scaleFactor * scaleFactor
  );
}
