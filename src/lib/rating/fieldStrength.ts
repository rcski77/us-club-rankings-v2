/**
 * Field Strength Score (FSS) and related signals for a single division -- see
 * docs/plan.md §2 "Field-strength signal". Pure math lives here (mirrors the
 * colley.ts / computeColleyRatings.ts split); Prisma orchestration is in
 * computeDivisionFieldStrength.ts.
 *
 * Kept deliberately separate, not blended into one hybrid number: FSS answers "how
 * strong is this field", bucket counts answer "how does that compare to the legacy
 * Analysis screen's breakdown" (display/justification only), and team
 * count/comparison volume are the raw scale-factor inputs (the suggestion-mapping
 * formula that weighs them against FSS is an undecided Phase 3 calibration detail --
 * see docs/plan.md Open Question 5/10).
 */

/** Mirrors the legacy Analysis screen's Top5/10/25/.../250 breakdown. */
export const BUCKET_THRESHOLDS = [5, 10, 25, 50, 100, 150, 200, 250] as const;
export type BucketThreshold = (typeof BUCKET_THRESHOLDS)[number];

export type ConfidenceWarning = "SMALL_FIELD" | "NO_HISTORY" | "LOW_PERCENT_RATED";

/**
 * Placeholder thresholds -- not calibrated against real historical data yet (see
 * docs/plan.md Open Question 5). Revisit during Phase 4 calibration.
 */
const SMALL_FIELD_TEAM_COUNT = 8;
const LOW_PERCENT_RATED_THRESHOLD = 0.5;

export type RatedTeam = {
  teamId: string;
  /** The team's latest national (season, ageGroup) Colley rank -- not its rank within this division. */
  nationalRank: number;
  rating: number;
  comparisons: number;
};

export type FieldStrengthResult = {
  teamCount: number;
  ratedTeamCount: number;
  percentTeamsRated: number;
  /** Mean Colley rating of the top half (by rating) of rated teams; null if none are rated. */
  fss: number | null;
  bucketCounts: Record<BucketThreshold, number>;
  /** Sum of comparisons across rated teams -- one of the two raw scale-factor inputs. */
  matchVolume: number;
  warnings: ConfidenceWarning[];
};

/**
 * Computes FSS + bucket counts + scale-factor inputs + confidence warnings for one
 * division, given its total team count and the latest ratings for whichever of its
 * teams are rated (unrated teams are still counted in teamCount/percentTeamsRated,
 * but don't contribute a rating to FSS or a rank to the bucket counts).
 */
export function computeFieldStrength(
  teamCount: number,
  ratedTeams: RatedTeam[],
): FieldStrengthResult {
  const ratedTeamCount = ratedTeams.length;
  const percentTeamsRated = teamCount === 0 ? 0 : ratedTeamCount / teamCount;

  const sorted = [...ratedTeams].sort((a, b) => b.rating - a.rating);
  // Round up so a small field (e.g. 1-3 rated teams) still yields a non-empty top half.
  const topHalfCount = Math.ceil(ratedTeamCount / 2);
  const topHalf = sorted.slice(0, topHalfCount);
  const fss =
    topHalf.length === 0
      ? null
      : topHalf.reduce((sum, t) => sum + t.rating, 0) / topHalf.length;

  const bucketCounts = Object.fromEntries(
    BUCKET_THRESHOLDS.map((threshold) => [
      threshold,
      ratedTeams.filter((t) => t.nationalRank <= threshold).length,
    ]),
  ) as Record<BucketThreshold, number>;

  const matchVolume = ratedTeams.reduce((sum, t) => sum + t.comparisons, 0);

  const warnings: ConfidenceWarning[] = [];
  if (teamCount < SMALL_FIELD_TEAM_COUNT) warnings.push("SMALL_FIELD");
  if (ratedTeamCount === 0) warnings.push("NO_HISTORY");
  else if (percentTeamsRated < LOW_PERCENT_RATED_THRESHOLD) warnings.push("LOW_PERCENT_RATED");

  return { teamCount, ratedTeamCount, percentTeamsRated, fss, bucketCounts, matchVolume, warnings };
}
