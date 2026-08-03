/**
 * Division Competitiveness Index (DCI) -- an Elo-based alternative to the Colley
 * FSS/elitePresence blend, modeled on VolleyLens' published "Tournament
 * Competitiveness Index" methodology (Elite Presence 40% / Strength of Field 25% /
 * Scale Factor 35%). Used in place of the Colley-based blend for a division once its
 * teams have Elo ratings (i.e. imported Match data) -- see computeDivisionScoringSuggestion.ts
 * for the per-division fallback to the Colley path when they don't (Elo has no
 * standings-inferred fallback of its own, per elo.ts).
 *
 * All three placeholder constants below are explicitly uncalibrated -- picked from a
 * one-time look at this project's actual current Elo distribution (see the ELO_ELITE_THRESHOLD
 * comment), not from any established formula, and expected to need revisiting as more
 * seasons of match data accumulate and ratings spread further from the 1500 default.
 */

/**
 * Absolute Elo cutoff for "elite." VolleyLens uses 1700, but that's calibrated against
 * their own (much larger, multi-season) Elo history. A population-relative cutoff
 * (e.g. this project's own top percentile) looks appealing but is the wrong idea
 * entirely: Elite Presence is intrinsic to a *division's own* teams, not the
 * population, so a threshold that only a small national percentile clears will make
 * even the single strongest field in the country look weak.
 *
 * Recalibrated 2026-08-04 via `prisma/analyzeEliteThreshold.ts` (`npm run
 * analyze:elite-threshold`, or against prod via `run-prod-script.sh`) after the
 * original 1450 was checked and found stale, one session after Elo's own tuning
 * constants were recalibrated (see this file's header comment and docs/plan.md's
 * Status entry, both 2026-08-03): that recalibration widened Elo's spread from the
 * 1500 default, which silently moved the whole rated population upward relative to
 * this constant -- prod data showed the population median landing almost exactly on
 * 1450, with 18% of Elo-eligible divisions pinned at exactly 100% Elite Presence
 * (Triple Crown NIT and a routine regional Open bracket both maxing out identically).
 * 1633 restores the original design's real gap: Triple Crown NIT / USAV Girls Junior
 * National Championship divisions land 91-100%, explicitly lower-tier ("Club"/
 * "Classic") named divisions land 0-3%, checked against real prod data both in
 * aggregate (division-level Elite Presence clustering at the 0%/100% extremes) and by
 * name (see the report's named-division sanity check). Not a population-relative
 * percentile -- it happens to land near the current population's ~75th percentile, but
 * that's incidental to the calibration, not the design (see the paragraph above for
 * why a percentile cutoff is the wrong idea for this specific metric). Revisit with
 * `analyzeEliteThreshold.ts` any time Elo's own tuning constants change again, since
 * that's exactly the failure mode that made 1450 go stale.
 */
export const ELO_ELITE_THRESHOLD = 1633;

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
 * % of this division's own Elo-rated teams at or above the elite threshold --
 * deliberately intrinsic to the division (no external population denominator, unlike
 * the Colley elitePresence metric), so it doesn't depend on how much of the season's
 * data existed the moment this division's snapshot happened to be generated.
 */
export function computeIntrinsicElitePresence(
  ratings: number[],
  threshold: number = ELO_ELITE_THRESHOLD,
): number {
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
