/**
 * Standard logistic Elo, applied in strict matchDate order (path-dependent -- a
 * backfill must replay every match from the start of the window to land on the same
 * ratings a live, incrementally-updated run would have produced; there is no
 * order-independent shortcut the way Colley's batch solve has).
 */

import { computeMatchPointDiff } from "./massey";

export type EloMatch = {
  teamAId: string;
  teamBId: string;
  winnerTeamId: string;
  matchDate: Date;
  setsA: number;
  setsB: number;
  /** Real per-set point scores, teamA's perspective (same convention as
   * massey.ts's MasseyMatch.pointDiff input) -- feeds marginMultiplier() so a
   * lopsided 25-8 set counts for more than a 25-23 set even when the set tally alone
   * (2-0 either way) can't tell them apart. Optional/defaults to [] so callers that
   * only have set counts (no per-set scores) still get the old set-fraction-only
   * behavior -- see marginMultiplier(). */
  setScores?: { a: number; b: number }[];
  /** K-factor multiplier for the match's division strength (see divisionWeight.ts).
   * Defaults to 1 (neutral) if omitted -- elo.ts stays domain-agnostic about *why*
   * this number is what it is, the same way it doesn't know why setsA/setsB are what
   * they are. Applied directionally, not symmetrically -- see
   * directionalDivisionWeight() below. */
  divisionWeight?: number;
  /** Flags a match in an OPEN-tier division for the extra flat win/loss bonus (see
   * OPEN_DIVISION_WIN_BONUS/OPEN_DIVISION_LOSS_SOFTEN below). Defaults to false.
   * Stacks multiplicatively with divisionWeight -- both are ways of saying "this
   * field is strong," from two different signals (Colley percentile vs. tier
   * label), so a real Open division typically gets both. */
  isOpenDivision?: boolean;
};

/** Same shape, plus the source Match's id -- needed to correlate a per-match rating
 * change back to a real match for history display (computeEloHistory below). */
export type EloMatchWithId = EloMatch & { id: string };

export type EloRating = { teamId: string; rating: number; matchesPlayed: number };

/**
 * One match's effect on both teams' ratings, from a chronological replay --
 * everything the "why did my rating move" UI needs, so it doesn't have to recompute
 * expected score/K/margin itself from the raw before/after numbers.
 */
export type EloStep = {
  matchId: string;
  matchDate: Date;
  teamAId: string;
  teamBId: string;
  winnerTeamId: string;
  setsA: number;
  setsB: number;
  ratingABefore: number;
  ratingAAfter: number;
  ratingBBefore: number;
  ratingBAfter: number;
  expectedA: number; // team A's win probability going into this match
  kA: number;
  kB: number;
  multiplier: number;
  /** The base Colley-percentile division weight (see divisionWeight.ts), before the
   * directional win/loss split or the Open-division bonus -- kept for display
   * ("this division was weighted 1.6x"), separate from the two below which are
   * what's actually applied per side. */
  divisionWeight: number;
  isOpenDivision: boolean;
  /** The full effective multiplier actually applied to team A/B's
   * (actual - expected) term this match -- directional divisionWeight combined with
   * the Open-division bonus if applicable. This is what answers "how much did this
   * specific match's weighting actually affect my rating," not just the base K. */
  effectiveWeightA: number;
  effectiveWeightB: number;
};

const DEFAULT_RATING = 1500;
const BASE_K = 24;
const PROVISIONAL_K = 40;
const PROVISIONAL_MATCH_THRESHOLD = 10; // below this many season matches, a team uses PROVISIONAL_K

/**
 * Extra flat multiplier for a match in an OPEN-tier division (see EloMatch.isOpenDivision),
 * on top of whatever divisionWeight already applies. Uncalibrated placeholder, same
 * status as every other constant in this rating system -- set per explicit user
 * direction (2026-07-30) after checking that stacking the original proposal (wins
 * 1.5x/losses 0.5x) on top of a 1.6 divisionWeight could swing a single provisional-K
 * match by ~58 rating points; this modest, roughly-inverse pair keeps that worst case
 * closer to ~44.
 */
export const OPEN_DIVISION_WIN_BONUS = 1.15;
export const OPEN_DIVISION_LOSS_SOFTEN = 0.87;

/**
 * Every constant in this file that's a tuning knob rather than a structural fact of
 * Elo, gathered so a backtest (see prisma/backtestElo.ts) can replay the same match
 * graph under different values without editing this file per candidate.
 * DEFAULT_ELO_CONFIG reproduces today's exact behavior -- every existing call site
 * (computeEloRatings.ts, getTeamEloHistory, and every pre-existing test in
 * elo.test.ts) omits `config` and gets this, so this refactor is purely additive.
 */
export type EloConfig = {
  /** K for a team's first `provisionalMatchThreshold` matches this season -- least
   * reliable prior, so most reactive. */
  provisionalK: number;
  provisionalMatchThreshold: number;
  /** K for a team with at least `provisionalMatchThreshold` but fewer than
   * `veteranMatchThreshold` matches -- a middle tier between "brand new" and
   * "long track record this season," on the theory that those two shouldn't share a
   * K just because both are past the provisional cutoff. Defaults to `baseK` with
   * `veteranMatchThreshold` equal to `provisionalMatchThreshold`, which collapses this
   * tier to empty and reproduces the original two-tier (provisional/base) behavior
   * exactly -- see DEFAULT_ELO_CONFIG. */
  midK: number;
  /** K for a team with at least this many matches -- the most-established, least
   * reactive tier. Named `baseK` (not `veteranK`) for backwards compatibility with
   * every existing caller of this config. */
  baseK: number;
  veteranMatchThreshold: number;
  openDivisionWinBonus: number;
  openDivisionLossSoften: number;
  /** Interpolates marginMultiplier()'s effect: 0 = no margin adjustment (multiplier
   * always 1, i.e. plain win/loss Elo), 1 = today's full effect. A single knob for
   * "does the margin-of-victory signal even help prediction accuracy," not just where
   * to set it. */
  marginStrength: number;
  /** false forces every match's divisionWeight to 1 (neutral), isolating whether
   * division-strength weighting helps prediction accuracy at all. */
  divisionWeightEnabled: boolean;
};

export const DEFAULT_ELO_CONFIG: EloConfig = {
  provisionalK: PROVISIONAL_K,
  provisionalMatchThreshold: PROVISIONAL_MATCH_THRESHOLD,
  midK: BASE_K,
  baseK: BASE_K,
  veteranMatchThreshold: PROVISIONAL_MATCH_THRESHOLD, // == provisionalMatchThreshold -> mid tier is empty by default
  openDivisionWinBonus: OPEN_DIVISION_WIN_BONUS,
  openDivisionLossSoften: OPEN_DIVISION_LOSS_SOFTEN,
  marginStrength: 1,
  divisionWeightEnabled: true,
};

/** provisional -> mid -> base(veteran), by matches played so far this season. See
 * EloConfig's field comments for what each tier represents. */
function resolveK(matchesPlayed: number, config: EloConfig): number {
  if (matchesPlayed < config.provisionalMatchThreshold) return config.provisionalK;
  if (matchesPlayed < config.veteranMatchThreshold) return config.midK;
  return config.baseK;
}

/**
 * divisionWeight (see divisionWeight.ts) used to apply symmetrically to both a win
 * and a loss in a division -- so the season's strongest-known division amplified
 * losses just as hard as it rewarded wins. Per explicit user direction (2026-07-30),
 * a win in an average-or-better division (weight >= 1) still gets the full weight
 * (a good win in a strong field should count for more), but a loss there is now
 * softened by the weight's reciprocal instead of amplified by it -- losing in the
 * season's strongest division no longer hurts more than losing in an average one, it
 * hurts less. Below-average divisions (weight < 1) are unchanged: that already
 * dampens both wins and losses, which wasn't the problem being fixed here.
 */
function directionalDivisionWeight(weight: number, isWin: boolean): number {
  if (isWin || weight < 1) return weight;
  return 1 / weight;
}

/** E_A = 1/(1+10^((R_B-R_A)/400)) */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Absolute point-differential share for a whole match: |sum(a-b)| / sum(a+b) across
 * every set, in [0, 1] (0 = the two sides scored the same total points across the
 * match even if the set count wasn't even; close to 1 = a near-shutout). Reuses
 * massey.ts's computeMatchPointDiff (which already sums each set's real a-b) rather
 * than re-deriving that sum a second way. [] returns 0 (no signal), same as any
 * caller with no per-set scores available.
 */
export function computeMatchPointDiffRatio(setScores: { a: number; b: number }[]): number {
  if (setScores.length === 0) return 0;
  const totalPoints = setScores.reduce((sum, s) => sum + s.a + s.b, 0);
  if (totalPoints === 0) return 0;
  return Math.abs(computeMatchPointDiff(setScores)) / totalPoints;
}

/**
 * Scales K by how decisively the match was won -- blends two signals, not just the
 * winner's set fraction alone (see docs/plan.md commit notes, 2026-07-30): the old
 * set-fraction-only version put every 2-1 split in the same bucket regardless of how
 * close the actual scoring was, so a 25-23/22-25/16-14 dead-even nail-biter and a
 * 25-10/20-25/15-3 near-blowout split both scored identically.
 *
 * setComponent: 1.2 for a sweep, ~1.067 for a split (2-of-3) -- same formula as
 * before, still meaningful on its own (a sweep demonstrates something a split
 * doesn't, independent of point margins).
 * pointComponent: 0.8-1.2 from computeMatchPointDiffRatio(), clamped at a ratio of
 * 0.5 (an already-extreme near-shutout) so one freakishly lopsided set can't send
 * the whole multiplier off the rails.
 * Blended 50/50. Falls back to setComponent alone (the old behavior) when no
 * per-set scores are available.
 *
 * `strength` interpolates the result toward 1 (no adjustment) -- 1 reproduces the raw
 * blend above unchanged, 0 collapses to a flat 1 regardless of margin. See
 * EloConfig.marginStrength.
 */
function marginMultiplier(
  winnerSets: number,
  totalSets: number,
  setScores: { a: number; b: number }[] = [],
  strength = 1,
): number {
  if (totalSets <= 0) return 1;
  const setComponent = 0.8 + 0.4 * (winnerSets / totalSets);
  const raw =
    setScores.length === 0
      ? setComponent
      : 0.5 * setComponent + 0.5 * (0.8 + Math.min(computeMatchPointDiffRatio(setScores), 0.5) * 0.8);
  return 1 + strength * (raw - 1);
}

/** Dominant/moderate/narrow classification from the margin multiplier -- shared by
 * explainEloChange() and classifyResult() below so the two descriptions of the same
 * match never disagree with each other. */
function classifyMargin(multiplier: number): "dominant" | "moderate" | "narrow" {
  return multiplier >= 1.1 ? "dominant" : multiplier <= 0.95 ? "narrow" : "moderate";
}

/**
 * Replays matches in chronological order, recording every step -- the shared core
 * behind computeEloRatings() (which only needs the final numbers) and
 * computeEloHistory() (which needs the full per-match trace). Keeping one
 * implementation here means the two callers can never drift out of sync on the
 * actual Elo math.
 */
function replay(matches: EloMatchWithId[], config: EloConfig = DEFAULT_ELO_CONFIG): EloStep[] {
  const ratings = new Map<string, number>();
  const matchesPlayed = new Map<string, number>();
  const getRating = (id: string) => ratings.get(id) ?? DEFAULT_RATING;
  const getCount = (id: string) => matchesPlayed.get(id) ?? 0;

  const sorted = [...matches].sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime());
  const steps: EloStep[] = [];

  for (const m of sorted) {
    const {
      id,
      teamAId,
      teamBId,
      winnerTeamId,
      setsA,
      setsB,
      matchDate,
      divisionWeight: rawDivisionWeight = 1,
      isOpenDivision = false,
      setScores = [],
    } = m;
    const divisionWeight = config.divisionWeightEnabled ? rawDivisionWeight : 1;
    const ratingABefore = getRating(teamAId);
    const ratingBBefore = getRating(teamBId);
    const expectedA = expectedScore(ratingABefore, ratingBBefore);
    const scoreA = winnerTeamId === teamAId ? 1 : 0;
    const aWon = winnerTeamId === teamAId;

    const winnerSets = aWon ? setsA : setsB;
    const multiplier = marginMultiplier(winnerSets, setsA + setsB, setScores, config.marginStrength);

    const kA = resolveK(getCount(teamAId), config);
    const kB = resolveK(getCount(teamBId), config);

    const openBonus = (won: boolean) =>
      isOpenDivision ? (won ? config.openDivisionWinBonus : config.openDivisionLossSoften) : 1;
    const effectiveWeightA = directionalDivisionWeight(divisionWeight, aWon) * openBonus(aWon);
    const effectiveWeightB = directionalDivisionWeight(divisionWeight, !aWon) * openBonus(!aWon);

    const ratingAAfter = ratingABefore + kA * multiplier * effectiveWeightA * (scoreA - expectedA);
    const ratingBAfter = ratingBBefore + kB * multiplier * effectiveWeightB * (1 - scoreA - (1 - expectedA));

    ratings.set(teamAId, ratingAAfter);
    ratings.set(teamBId, ratingBAfter);
    matchesPlayed.set(teamAId, getCount(teamAId) + 1);
    matchesPlayed.set(teamBId, getCount(teamBId) + 1);

    steps.push({
      matchId: id,
      matchDate,
      teamAId,
      teamBId,
      winnerTeamId,
      setsA,
      setsB,
      ratingABefore,
      ratingAAfter,
      ratingBBefore,
      ratingBAfter,
      expectedA,
      kA,
      kB,
      multiplier,
      divisionWeight,
      isOpenDivision,
      effectiveWeightA,
      effectiveWeightB,
    });
  }

  return steps;
}

/**
 * Replays a list of completed matches in chronological order, applying the Elo
 * update to both teams after each one. Teams unseen so far start at DEFAULT_RATING.
 * Returns one row per team that appeared in at least one match -- order is
 * unspecified, callers rank/sort as needed (mirrors solveColley's contract).
 */
export function computeEloRatings(matches: EloMatch[], config: EloConfig = DEFAULT_ELO_CONFIG): EloRating[] {
  const withIds: EloMatchWithId[] = matches.map((m, i) => ({ ...m, id: String(i) }));
  const steps = replay(withIds, config);

  const ratings = new Map<string, number>();
  const matchesPlayed = new Map<string, number>();
  for (const step of steps) {
    ratings.set(step.teamAId, step.ratingAAfter);
    ratings.set(step.teamBId, step.ratingBAfter);
    matchesPlayed.set(step.teamAId, (matchesPlayed.get(step.teamAId) ?? 0) + 1);
    matchesPlayed.set(step.teamBId, (matchesPlayed.get(step.teamBId) ?? 0) + 1);
  }

  return Array.from(ratings.entries()).map(([teamId, rating]) => ({
    teamId,
    rating,
    matchesPlayed: matchesPlayed.get(teamId) ?? 0,
  }));
}

/**
 * Same replay, but returns the full per-match trace rather than just final ratings --
 * powers a team's Elo history view ("why did my rating change on this match").
 */
export function computeEloHistory(matches: EloMatchWithId[], config: EloConfig = DEFAULT_ELO_CONFIG): EloStep[] {
  return replay(matches, config);
}

/**
 * Builds EloMatchWithId rows from completed Match records -- the Prisma-shaped input,
 * analogous to colley.ts's buildMatchComparisons(). Skips a match with no resolved
 * winner, a null team side, or no matchDate (Elo's chronological replay has no
 * sensible place to put an undated match).
 */
export function buildEloMatches(
  matches: {
    id: string;
    teamAId: string | null;
    teamBId: string | null;
    winnerTeamId: string | null;
    matchDate: Date | null;
    setsA: number;
    setsB: number;
    /** Passed through as-is if present -- see computeMatchDivisionWeights.ts, which
     * attaches this to the raw match row before it reaches here. */
    divisionWeight?: number;
    /** Passed through as-is if present -- see withDivisionWeights() in
     * computeEloRatings.ts, which sets this from the match's own division.tierLabel. */
    isOpenDivision?: boolean;
    /** Passed through as-is if present -- caller coerces Prisma's raw Json field into
     * this shape first (see computeEloRatings.ts, mirroring computeMasseyRatings.ts's
     * identical coercion for the same underlying Match.setScores column). */
    setScores?: { a: number; b: number }[];
  }[],
): EloMatchWithId[] {
  const result: EloMatchWithId[] = [];
  for (const m of matches) {
    if (!m.teamAId || !m.teamBId || !m.winnerTeamId || !m.matchDate) continue;
    result.push({
      id: m.id,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      winnerTeamId: m.winnerTeamId,
      matchDate: m.matchDate,
      setsA: m.setsA,
      setsB: m.setsB,
      divisionWeight: m.divisionWeight,
      isOpenDivision: m.isOpenDivision,
      setScores: m.setScores,
    });
  }
  return result;
}

/**
 * Plain-language explanation of one team's rating change from an EloStep, for the
 * "why your Elo changed" history UI. Classifies the team's pre-match win probability
 * (favorite/even/underdog) and the match's margin (dominant/moderate/narrow), and
 * combines them into a sentence -- mirrors how a reader intuitively judges a result:
 * "did I win one I should have?", "was it close?".
 */
export function explainEloChange(args: { won: boolean; expected: number; multiplier: number }): string {
  const { won, expected, multiplier } = args;
  const role = expected >= 0.65 ? "favorite" : expected <= 0.35 ? "underdog" : "even";
  const margin = classifyMargin(multiplier);

  if (won) {
    if (role === "favorite") {
      const marginClause =
        margin === "dominant"
          ? " The dominant margin still earned solid credit."
          : margin === "narrow"
            ? " The narrow margin limited the credit further."
            : "";
      return `A win you were expected to get, so your rating moved up only a little.${marginClause}`;
    }
    if (role === "underdog") {
      const marginClause = margin === "dominant" ? ", boosted further by the dominant margin" : "";
      return `An upset win over a stronger opponent, so your rating jumped significantly${marginClause}.`;
    }
    const marginClause = margin === "dominant" ? ", helped by the dominant margin" : "";
    return `A win against a closely-matched opponent, so your rating moved up a moderate amount${marginClause}.`;
  }

  if (role === "underdog") {
    return "A loss to a stronger opponent was expected, so your rating moved down only a little.";
  }
  if (role === "favorite") {
    return "An upset loss to a weaker opponent, so your rating dropped significantly.";
  }
  return "A loss to a closely-matched opponent, so your rating moved down a moderate amount.";
}

/**
 * Short "Dominant Win (+17 pts)" style label for one team's result in a match --
 * replaces a raw tournament stage (pool play/bracket, mostly-uninformative once a
 * match is being read for its rating impact) in the per-match history UI, modeled on
 * a competitor site's own per-match result label.
 */
export function classifyResult(args: { won: boolean; multiplier: number; delta: number }): string {
  const { won, multiplier, delta } = args;
  const margin = classifyMargin(multiplier);
  const marginLabel = margin === "dominant" ? "Dominant" : margin === "narrow" ? "Narrow" : "Moderate";
  const outcomeLabel = won ? "Win" : "Loss";
  const sign = delta >= 0 ? "+" : "";
  return `${marginLabel} ${outcomeLabel} (${sign}${delta.toFixed(0)} pts)`;
}

/**
 * "much weaker"/"weaker"/"evenly matched"/"stronger"/"much stronger" label for an
 * opponent, from this team's pre-match win expectation against them -- the same
 * signal explainEloChange()'s favorite/underdog role classification uses, just with
 * an extra tier for a lopsided expectation (>=85%/<=15%) so a genuine blowout-on-paper
 * matchup reads differently from a merely-favored one.
 */
export function classifyOpponentStrength(expected: number): string {
  if (expected >= 0.85) return "much weaker";
  if (expected >= 0.65) return "weaker";
  if (expected > 0.35) return "evenly matched";
  if (expected > 0.15) return "stronger";
  return "much stronger";
}

/**
 * Plain-language sentence describing the division-strength adjustment applied to one
 * side of a match, for the same "why your Elo changed" panel -- null when neither the
 * Colley-based divisionWeight nor the Open-division bonus meaningfully applied (a
 * neutral weight of 1 in a non-Open division), so the UI can skip the line entirely
 * rather than stating a no-op.
 */
export function explainDivisionEffect(args: {
  won: boolean;
  divisionWeight: number;
  isOpenDivision: boolean;
}): string | null {
  const { won, divisionWeight, isOpenDivision } = args;
  const strong = divisionWeight > 1.02;
  const weak = divisionWeight < 0.98;

  const parts: string[] = [];
  if (isOpenDivision) parts.push("Open division");
  if (strong) parts.push(`strength-weighted ${divisionWeight.toFixed(2)}x`);
  else if (weak) parts.push(`strength-weighted ${divisionWeight.toFixed(2)}x (below average)`);

  if (parts.length === 0) return null;
  const prefix = parts.join(", ");

  if (isOpenDivision || strong) {
    return won
      ? `${prefix} — wins count for more here.`
      : `${prefix} — losses are softened instead of amplified.`;
  }
  // weak-only, no Open bonus: still symmetric today, see directionalDivisionWeight().
  return `${prefix} — this match counted for less either way.`;
}
