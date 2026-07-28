import { describe, expect, it } from "vitest";
import { computeDivisionWeight, WEIGHT_MAX, WEIGHT_MIN } from "./divisionWeight";

describe("computeDivisionWeight", () => {
  it("returns a neutral weight of 1 when there's no percentile signal yet", () => {
    expect(computeDivisionWeight(null, [50, 60, 70])).toBe(1);
  });

  it("returns a neutral weight of 1 when the population has fewer than 2 divisions", () => {
    expect(computeDivisionWeight(80, [])).toBe(1);
    expect(computeDivisionWeight(80, [80])).toBe(1);
  });

  it("gives the weakest division in the population WEIGHT_MIN", () => {
    const population = [53.3, 63.7, 78.8, 89.8, 98.1];
    expect(computeDivisionWeight(53.3, population)).toBeCloseTo(WEIGHT_MIN, 10);
  });

  it("gives the strongest division in the population WEIGHT_MAX", () => {
    const population = [53.3, 63.7, 78.8, 89.8, 98.1];
    expect(computeDivisionWeight(98.1, population)).toBeCloseTo(WEIGHT_MAX, 10);
  });

  it("spreads a middle division evenly between the min and max", () => {
    // 5 evenly-spaced divisions: the middle one (rank 3 of 5) should land at the
    // midpoint of the weight range, regardless of the population's absolute percentile
    // values -- this is a rank transform, not a fixed-scale linear map.
    const population = [10, 20, 30, 40, 50];
    expect(computeDivisionWeight(30, population)).toBeCloseTo((WEIGHT_MIN + WEIGHT_MAX) / 2, 10);
  });

  it("is monotonically increasing with rank", () => {
    const population = [53.3, 63.7, 68.2, 78.8, 85.0, 89.8, 98.1];
    const low = computeDivisionWeight(63.7, population);
    const mid = computeDivisionWeight(78.8, population);
    const high = computeDivisionWeight(89.8, population);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it("gives two divisions tied at the same percentile the same weight", () => {
    const population = [50, 70, 70, 90];
    const a = computeDivisionWeight(70, population);
    const b = computeDivisionWeight(70, population);
    expect(a).toBe(b);
  });

  it("is unaffected by a fixed [0, 100] scale -- only rank within the real population matters", () => {
    // Real division percentiles never approach 0 or 100 in practice (see the file's
    // header comment) -- this confirms the weight comes from rank among what's
    // actually observed, not a comparison against the theoretical percentile scale.
    const tightlyClustered = [90, 92, 94, 96, 98];
    expect(computeDivisionWeight(90, tightlyClustered)).toBeCloseTo(WEIGHT_MIN, 10);
    expect(computeDivisionWeight(98, tightlyClustered)).toBeCloseTo(WEIGHT_MAX, 10);
  });
});
