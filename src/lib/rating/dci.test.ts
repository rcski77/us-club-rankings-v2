import { describe, expect, it } from "vitest";
import {
  computeDci,
  computeEliteThreshold,
  computeIntrinsicElitePresence,
  computeScaleFactor,
  computeTopQuartileMean,
  ELITE_PERCENTILE,
} from "./dci";

describe("computeIntrinsicElitePresence", () => {
  it("returns 0 for an empty division", () => {
    expect(computeIntrinsicElitePresence([], 1600)).toBe(0);
  });

  it("computes the share of the division's own teams at or above the threshold", () => {
    expect(computeIntrinsicElitePresence([1650, 1600, 1500, 1400], 1600)).toBe(50);
  });
});

describe("computeEliteThreshold", () => {
  it("returns null for an empty population", () => {
    expect(computeEliteThreshold([])).toBeNull();
  });

  it("returns the rating at the given percentile", () => {
    // 10 sorted values, p50 -> index 5 (0-indexed) -> the 6th value
    const population = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(computeEliteThreshold(population, 50)).toBe(600);
    expect(computeEliteThreshold(population, 0)).toBe(100);
    expect(computeEliteThreshold(population, 90)).toBe(1000);
  });

  it("defaults to ELITE_PERCENTILE", () => {
    const population = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(computeEliteThreshold(population)).toBe(computeEliteThreshold(population, ELITE_PERCENTILE));
  });

  it("is order-independent", () => {
    const sorted = [100, 200, 300, 400, 500];
    const shuffled = [400, 100, 500, 200, 300];
    expect(computeEliteThreshold(shuffled, 50)).toBe(computeEliteThreshold(sorted, 50));
  });
});

describe("computeTopQuartileMean", () => {
  it("returns null for an empty list", () => {
    expect(computeTopQuartileMean([])).toBeNull();
  });

  it("averages the top quartile (by rating)", () => {
    // ceil(8/4) = 2 -> top quartile is 800, 700 -> mean 750
    expect(computeTopQuartileMean([100, 200, 300, 400, 500, 600, 700, 800])).toBe(750);
  });

  it("rounds the quartile count up for a small field", () => {
    // ceil(3/4) = 1 -> top quartile is just the single highest rating
    expect(computeTopQuartileMean([100, 200, 300])).toBe(300);
  });
});

describe("computeScaleFactor", () => {
  it("clamps at 100 when both inputs meet or exceed their reference points", () => {
    expect(computeScaleFactor(100, 1000)).toBe(100);
    expect(computeScaleFactor(500, 5000)).toBe(100);
  });

  it("scales linearly below the reference points", () => {
    // 50/100 teams -> 50, 500/1000 matches -> 50 -> mean 50
    expect(computeScaleFactor(50, 500)).toBe(50);
  });

  it("averages the two components when they differ", () => {
    // teams fully scaled (100), matches at 0 -> mean 50
    expect(computeScaleFactor(100, 0)).toBe(50);
  });
});

describe("computeDci", () => {
  it("blends the three components at the default 40/25/35 weights", () => {
    // 0.4*100 + 0.25*100 + 0.35*100 = 100
    expect(computeDci(100, 100, 100)).toBeCloseTo(100, 10);
  });

  it("weighs elite presence, strength of field, and scale factor independently", () => {
    // 0.4*80 + 0.25*60 + 0.35*40 = 32 + 15 + 14 = 61
    expect(computeDci(80, 60, 40)).toBeCloseTo(61, 10);
  });

  it("supports custom weights", () => {
    const weights = { elitePresence: 0.5, strengthOfField: 0.3, scaleFactor: 0.2 };
    // 0.5*80 + 0.3*60 + 0.2*40 = 40 + 18 + 8 = 66
    expect(computeDci(80, 60, 40, weights)).toBeCloseTo(66, 10);
  });
});
