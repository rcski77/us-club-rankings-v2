/** One inferred comparison: winnerTeamId beat loserTeamId within a single division. */
export type Comparison = { winnerTeamId: string; loserTeamId: string };

export type ColleyRating = { teamId: string; rating: number; comparisons: number };

/**
 * Solves the Colley Matrix Method for one graph of teams/comparisons.
 * C[i][i] = 2 + comparisons_i, C[i][j] = -commonComparisons_ij, b_i = 1 + (wins_i - losses_i)/2.
 * Graphs here are small (at most a few hundred teams per age group), so a hand-rolled
 * Gaussian elimination is plenty -- no need for a numeric-library dependency.
 */
export function solveColley(comparisons: Comparison[]): ColleyRating[] {
  const teamIds = Array.from(
    new Set(comparisons.flatMap((c) => [c.winnerTeamId, c.loserTeamId])),
  );
  const n = teamIds.length;
  if (n === 0) return [];

  const index = new Map(teamIds.map((id, i) => [id, i]));
  const wins = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  const common = Array.from({ length: n }, () => new Array(n).fill(0));

  for (const { winnerTeamId, loserTeamId } of comparisons) {
    const w = index.get(winnerTeamId)!;
    const l = index.get(loserTeamId)!;
    wins[w] += 1;
    losses[l] += 1;
    common[w][l] += 1;
    common[l][w] += 1;
  }

  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const teamComparisons = wins[i] + losses[i];
    C[i][i] = 2 + teamComparisons;
    b[i] = 1 + (wins[i] - losses[i]) / 2;
    for (let j = 0; j < n; j++) {
      if (j !== i) C[i][j] = -common[i][j];
    }
  }

  const ratings = gaussianSolve(C, b);

  return teamIds.map((teamId, i) => ({
    teamId,
    rating: ratings[i],
    comparisons: wins[i] + losses[i],
  }));
}

/** Solves Cx = b via Gaussian elimination with partial pivoting. C is square, n small. */
function gaussianSolve(C: number[][], b: number[]): number[] {
  const n = b.length;
  const A = C.map((row) => [...row]);
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

/**
 * Builds pairwise win/loss comparisons from one division's TeamFinish rows. Same-rank
 * ties produce no comparison between each other -- only against teams at other ranks.
 */
export function buildDivisionComparisons(
  finishes: { teamId: string; rank: number }[],
): Comparison[] {
  const comparisons: Comparison[] = [];
  for (let i = 0; i < finishes.length; i++) {
    for (let j = i + 1; j < finishes.length; j++) {
      const a = finishes[i];
      const b = finishes[j];
      if (a.rank === b.rank) continue;
      const [winner, loser] = a.rank < b.rank ? [a, b] : [b, a];
      comparisons.push({ winnerTeamId: winner.teamId, loserTeamId: loser.teamId });
    }
  }
  return comparisons;
}

/**
 * Builds one comparison per completed Match row -- the Phase 5 (real match data) input,
 * used in place of buildDivisionComparisons() for a division once it has imported Match
 * results, per computeColleyRatings()'s per-division fallback. A match with no resolved
 * winner (or a null team side -- Match's FKs are nullable in the schema, though never in
 * practice for a committed row) is skipped rather than producing a degenerate comparison.
 */
export function buildMatchComparisons(
  matches: { teamAId: string | null; teamBId: string | null; winnerTeamId: string | null }[],
): Comparison[] {
  const comparisons: Comparison[] = [];
  for (const m of matches) {
    if (!m.teamAId || !m.teamBId || !m.winnerTeamId) continue;
    const loserTeamId = m.winnerTeamId === m.teamAId ? m.teamBId : m.teamAId;
    comparisons.push({ winnerTeamId: m.winnerTeamId, loserTeamId });
  }
  return comparisons;
}
