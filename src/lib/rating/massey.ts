/** One match's point differential input to the Massey solve: teamA's advantage over teamB. */
export type MasseyMatch = {
  teamAId: string;
  teamBId: string;
  pointDiff: number;
  /** Division-strength weight for this match (see divisionWeight.ts). Defaults to 1
   * (neutral) if omitted -- massey.ts stays domain-agnostic about *why* this number is
   * what it is, mirroring elo.ts's EloMatch.divisionWeight. */
  divisionWeight?: number;
};

export type MasseyRating = { teamId: string; rating: number; comparisons: number };

/**
 * Ridge regularization strength added to every diagonal entry before solving. The
 * Massey matrix is singular by construction (rows sum to zero), and ridge also
 * naturally damps small/disconnected subgraphs (an isolated pair of teams solves
 * cleanly, pulled toward 0) rather than needing Colley's row-replacement trick. Not
 * calibrated against real data yet -- same status as elo.ts's K-factor constants
 * (docs/plan.md §7 item 10).
 */
export const DEFAULT_RIDGE_LAMBDA = 1;

/** Sums each set's (a - b) across a whole match -- the real per-set point scores, not just sets won. */
export function computeMatchPointDiff(setScores: { a: number; b: number }[]): number {
  return setScores.reduce((sum, s) => sum + (s.a - s.b), 0);
}

/**
 * Builds Massey inputs from raw Match-shaped rows -- filters to matches with both
 * team sides resolved and at least one set's real score recorded (mirrors
 * buildEloMatches's filtering style in elo.ts).
 */
export function buildMasseyMatches(
  matches: {
    teamAId: string | null;
    teamBId: string | null;
    setScores: { a: number; b: number }[];
    /** Passed through as-is if present -- see computeMasseyRatings.ts, which attaches
     * this to the raw match row before it reaches here (same as buildEloMatches). */
    divisionWeight?: number;
  }[],
): MasseyMatch[] {
  const result: MasseyMatch[] = [];
  for (const m of matches) {
    if (!m.teamAId || !m.teamBId || m.setScores.length === 0) continue;
    result.push({
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      pointDiff: computeMatchPointDiff(m.setScores),
      divisionWeight: m.divisionWeight,
    });
  }
  return result;
}

/**
 * Solves the Massey Matrix Method for one graph of teams/matches: for a match between
 * i/j with signed differential d (i's advantage), M[i][i] += w, M[j][j] += w,
 * M[i][j] -= w, M[j][i] -= w, b[i] += w*d, b[j] -= w*d, where w is the match's
 * divisionWeight (defaults to 1 -- every pre-existing test case still passes
 * unmodified). This is the Massey analog of elo.ts's K-factor scaling: standard
 * weighted-least-squares, since Massey's matrix *is* the normal-equations matrix of a
 * least-squares fit -- scaling one observation's row/contribution by w is exactly how
 * WLS gives that observation more or less say in the solve. Deliberately not scaling
 * ridgeLambda itself: ridge is a per-team regularization term, not a per-match
 * observation, so it stays independent of any individual match's weight.
 * Ridge-regularized (see DEFAULT_RIDGE_LAMBDA) rather than Colley's row-replacement
 * trick. Graphs here are small (at most a few hundred teams per age group), so a
 * hand-rolled Gaussian elimination is plenty -- no need for a numeric-library
 * dependency (same call as colley.ts, which keeps its own copy rather than sharing one
 * across these self-contained pure-math modules).
 */
export function solveMassey(matches: MasseyMatch[], ridgeLambda = DEFAULT_RIDGE_LAMBDA): MasseyRating[] {
  const teamIds = Array.from(new Set(matches.flatMap((m) => [m.teamAId, m.teamBId])));
  const n = teamIds.length;
  if (n === 0) return [];

  const index = new Map(teamIds.map((id, i) => [id, i]));
  const gamesPlayed = new Array(n).fill(0);
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);

  for (const { teamAId, teamBId, pointDiff, divisionWeight = 1 } of matches) {
    const i = index.get(teamAId)!;
    const j = index.get(teamBId)!;
    gamesPlayed[i] += 1;
    gamesPlayed[j] += 1;
    M[i][i] += divisionWeight;
    M[j][j] += divisionWeight;
    M[i][j] -= divisionWeight;
    M[j][i] -= divisionWeight;
    b[i] += divisionWeight * pointDiff;
    b[j] -= divisionWeight * pointDiff;
  }

  for (let i = 0; i < n; i++) M[i][i] += ridgeLambda;

  const ratings = gaussianSolve(M, b);

  return teamIds.map((teamId, i) => ({
    teamId,
    rating: ratings[i],
    comparisons: gamesPlayed[i],
  }));
}

/** Solves Mx = b via Gaussian elimination with partial pivoting. M is square, n small. */
function gaussianSolve(M: number[][], b: number[]): number[] {
  const n = b.length;
  const A = M.map((row) => [...row]);
  const x = [...b];

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivotRow][col])) pivotRow = row;
    }
    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [x[col], x[pivotRow]] = [x[pivotRow], x[col]];
    }

    const pivot = A[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      for (let k = col; k < n; k++) A[row][k] -= factor * A[col][k];
      x[row] -= factor * x[col];
    }
  }

  const result = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row];
    for (let k = row + 1; k < n; k++) sum -= A[row][k] * result[k];
    result[row] = sum / A[row][row];
  }
  return result;
}
