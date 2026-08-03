import { describe, expect, it } from "vitest";
import { scoreEloSteps, scorePredictions } from "./predictionMetrics";
import { EloStep } from "./elo";

describe("scorePredictions", () => {
  it("returns NaN metrics for no samples", () => {
    const result = scorePredictions([]);
    expect(result.n).toBe(0);
    expect(result.accuracy).toBeNaN();
    expect(result.logLoss).toBeNaN();
    expect(result.brier).toBeNaN();
  });

  it("scores perfect confident predictions as accuracy 1, logLoss/brier near 0", () => {
    const result = scorePredictions([
      { expected: 0.99, actualWin: true },
      { expected: 0.01, actualWin: false },
    ]);
    expect(result.accuracy).toBe(1);
    expect(result.logLoss).toBeLessThan(0.02);
    expect(result.brier).toBeLessThan(0.001);
  });

  it("scores confidently-wrong predictions with a large but finite logLoss", () => {
    const result = scorePredictions([{ expected: 0.999999999, actualWin: false }]);
    expect(result.accuracy).toBe(0);
    expect(Number.isFinite(result.logLoss)).toBe(true);
    expect(result.logLoss).toBeGreaterThan(10);
  });

  it("scores a coin-flip prediction with logLoss close to ln(2)", () => {
    const result = scorePredictions([
      { expected: 0.5, actualWin: true },
      { expected: 0.5, actualWin: false },
    ]);
    expect(result.logLoss).toBeCloseTo(Math.log(2), 10);
    expect(result.brier).toBeCloseTo(0.25, 10);
  });

  it("matches hand-computed values for a mixed case", () => {
    // expected=0.7 win: logLoss=-ln(0.7), brier=(1-0.7)^2=0.09
    // expected=0.3 win (an upset, predicted underdog won): logLoss=-ln(0.3), brier=(1-0.3)^2=0.49
    const result = scorePredictions([
      { expected: 0.7, actualWin: true },
      { expected: 0.3, actualWin: true },
    ]);
    expect(result.n).toBe(2);
    expect(result.accuracy).toBe(0.5); // only the first prediction called the winner correctly
    expect(result.logLoss).toBeCloseTo((-Math.log(0.7) + -Math.log(0.3)) / 2, 10);
    expect(result.brier).toBeCloseTo((0.09 + 0.49) / 2, 10);
  });
});

describe("scoreEloSteps", () => {
  function step(overrides: Partial<EloStep>): EloStep {
    return {
      matchId: "m1",
      matchDate: new Date("2026-01-01"),
      teamAId: "a",
      teamBId: "b",
      winnerTeamId: "a",
      setsA: 2,
      setsB: 0,
      ratingABefore: 1500,
      ratingAAfter: 1516,
      ratingBBefore: 1500,
      ratingBAfter: 1484,
      expectedA: 0.5,
      kA: 24,
      kB: 24,
      multiplier: 1,
      divisionWeight: 1,
      isOpenDivision: false,
      effectiveWeightA: 1,
      effectiveWeightB: 1,
      ...overrides,
    };
  }

  it("maps each step to a teamA-perspective prediction sample", () => {
    const result = scoreEloSteps([
      step({ expectedA: 0.9, winnerTeamId: "a", teamAId: "a", teamBId: "b" }),
      step({ expectedA: 0.1, winnerTeamId: "b", teamAId: "a", teamBId: "b" }),
    ]);
    expect(result.n).toBe(2);
    expect(result.accuracy).toBe(1);
  });

  it("returns no-data metrics for no steps", () => {
    expect(scoreEloSteps([]).n).toBe(0);
  });
});
