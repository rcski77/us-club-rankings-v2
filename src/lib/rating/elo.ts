/**
 * Standard logistic Elo, applied in strict matchDate order (path-dependent -- a
 * backfill must replay every match from the start of the window to land on the same
 * ratings a live, incrementally-updated run would have produced; there is no
 * order-independent shortcut the way Colley's batch solve has).
 */

export type EloMatch = {
  teamAId: string;
  teamBId: string;
  winnerTeamId: string;
  matchDate: Date;
  setsA: number;
  setsB: number;
  /** K-factor multiplier for the match's division strength (see divisionWeight.ts).
   * Defaults to 1 (neutral) if omitted -- elo.ts stays domain-agnostic about *why*
   * this number is what it is, the same way it doesn't know why setsA/setsB are what
   * they are. */
  divisionWeight?: number;
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
  divisionWeight: number;
};

const DEFAULT_RATING = 1500;
const BASE_K = 24;
const PROVISIONAL_K = 40;
const PROVISIONAL_MATCH_THRESHOLD = 10; // below this many season matches, a team uses PROVISIONAL_K

/** E_A = 1/(1+10^((R_B-R_A)/400)) */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Scales K by how decisively the match was won, from the winner's set fraction.
 * A sweep (e.g. 2-0) counts for more than a narrow win (e.g. 2-1) -- 1.2x vs ~1.07x.
 * Falls back to 1 (no scaling) if set counts are missing/zero, e.g. a walkover.
 */
function marginMultiplier(winnerSets: number, totalSets: number): number {
  if (totalSets <= 0) return 1;
  const fraction = winnerSets / totalSets;
  return 0.8 + 0.4 * fraction;
}

/**
 * Replays matches in chronological order, recording every step -- the shared core
 * behind computeEloRatings() (which only needs the final numbers) and
 * computeEloHistory() (which needs the full per-match trace). Keeping one
 * implementation here means the two callers can never drift out of sync on the
 * actual Elo math.
 */
function replay(matches: EloMatchWithId[]): EloStep[] {
  const ratings = new Map<string, number>();
  const matchesPlayed = new Map<string, number>();
  const getRating = (id: string) => ratings.get(id) ?? DEFAULT_RATING;
  const getCount = (id: string) => matchesPlayed.get(id) ?? 0;

  const sorted = [...matches].sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime());
  const steps: EloStep[] = [];

  for (const m of sorted) {
    const { id, teamAId, teamBId, winnerTeamId, setsA, setsB, matchDate, divisionWeight = 1 } = m;
    const ratingABefore = getRating(teamAId);
    const ratingBBefore = getRating(teamBId);
    const expectedA = expectedScore(ratingABefore, ratingBBefore);
    const scoreA = winnerTeamId === teamAId ? 1 : 0;

    const winnerSets = winnerTeamId === teamAId ? setsA : setsB;
    const multiplier = marginMultiplier(winnerSets, setsA + setsB);

    const kA = getCount(teamAId) < PROVISIONAL_MATCH_THRESHOLD ? PROVISIONAL_K : BASE_K;
    const kB = getCount(teamBId) < PROVISIONAL_MATCH_THRESHOLD ? PROVISIONAL_K : BASE_K;

    const ratingAAfter = ratingABefore + kA * multiplier * divisionWeight * (scoreA - expectedA);
    const ratingBAfter = ratingBBefore + kB * multiplier * divisionWeight * (1 - scoreA - (1 - expectedA));

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
export function computeEloRatings(matches: EloMatch[]): EloRating[] {
  const withIds: EloMatchWithId[] = matches.map((m, i) => ({ ...m, id: String(i) }));
  const steps = replay(withIds);

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
export function computeEloHistory(matches: EloMatchWithId[]): EloStep[] {
  return replay(matches);
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
  const margin = multiplier >= 1.1 ? "dominant" : multiplier <= 0.95 ? "narrow" : "moderate";

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
