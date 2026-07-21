import { describe, expect, it } from "vitest";
import { computeRatingHistogram } from "./ratingHistogram";

describe("computeRatingHistogram", () => {
  it("returns a single empty bin for no ratings", () => {
    const result = computeRatingHistogram([]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0].count).toBe(0);
  });

  it("returns a single bin spanning the value when all ratings are equal", () => {
    const result = computeRatingHistogram([2, 2, 2]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0].count).toBe(3);
    expect(result.min).toBe(2);
    expect(result.max).toBe(2);
  });

  it("splits ratings into equal-width bins and counts each", () => {
    const result = computeRatingHistogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(result.bins).toHaveLength(5);
    expect(result.bins.reduce((sum, b) => sum + b.count, 0)).toBe(11);
    expect(result.min).toBe(0);
    expect(result.max).toBe(10);
  });

  it("puts the maximum value in the last bin, not a phantom overflow bin", () => {
    const result = computeRatingHistogram([0, 10], 2);
    expect(result.bins).toHaveLength(2);
    expect(result.bins[0].count).toBe(1);
    expect(result.bins[1].count).toBe(1);
  });
});
