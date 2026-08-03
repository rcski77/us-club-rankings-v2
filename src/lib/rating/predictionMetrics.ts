import { EloStep } from "./elo";

/** One prediction to score: the pre-match win probability given to "the team we're
 * scoring from," and whether that team actually won. */
export type PredictionSample = { expected: number; actualWin: boolean };

export type PredictionMetrics = {
  n: number;
  /** Fraction where the more-likely side (expected >= 0.5) actually won. */
  accuracy: number;
  /** Mean negative log-likelihood of the actual outcome under the predicted
   * probability -- lower is better, 0 is a perfect confident prediction. Standard
   * metric for calibrating a probabilistic classifier (what a rating system's win
   * probability is). */
  logLoss: number;
  /** Mean squared error between the predicted probability and the actual outcome
   * (0/1) -- lower is better. Less sensitive to confident-wrong predictions than
   * logLoss, a useful second opinion. */
  brier: number;
};

// Clamp away from the exact 0/1 boundary so a confident-wrong prediction produces a
// large but finite logLoss instead of -Infinity.
const EPSILON = 1e-6;

/**
 * Scores a set of pre-match win-probability predictions against what actually
 * happened. Returns NaN metrics (not a throw) for an empty input -- a
 * config/partition combination with no eligible matches shouldn't crash a
 * long-running grid search, just show up as "no data" in the report.
 */
export function scorePredictions(samples: PredictionSample[]): PredictionMetrics {
  const n = samples.length;
  if (n === 0) return { n: 0, accuracy: NaN, logLoss: NaN, brier: NaN };

  let correct = 0;
  let logLossSum = 0;
  let brierSum = 0;
  for (const { expected, actualWin } of samples) {
    const predictedWin = expected >= 0.5;
    if (predictedWin === actualWin) correct += 1;

    const p = Math.min(Math.max(expected, EPSILON), 1 - EPSILON);
    logLossSum += actualWin ? -Math.log(p) : -Math.log(1 - p);

    const outcome = actualWin ? 1 : 0;
    brierSum += (outcome - expected) ** 2;
  }

  return { n, accuracy: correct / n, logLoss: logLossSum / n, brier: brierSum / n };
}

/**
 * Scores a chronological Elo replay's steps (see elo.ts's computeEloHistory) --
 * `expectedA` is already the pre-match win probability computed from ratings *before*
 * that match's update, so no new replay logic is needed here, just this mapping into
 * PredictionSample from teamA's perspective.
 */
export function scoreEloSteps(steps: EloStep[]): PredictionMetrics {
  return scorePredictions(
    steps.map((s) => ({ expected: s.expectedA, actualWin: s.winnerTeamId === s.teamAId })),
  );
}
