import { describe, expect, it } from "vitest";
import { computeFieldStrength } from "./fieldStrength";

describe("computeFieldStrength", () => {
  it("returns a null FSS and NO_HISTORY warning when no teams are rated", () => {
    const result = computeFieldStrength(10, []);
    expect(result.fss).toBeNull();
    expect(result.ratedTeamCount).toBe(0);
    expect(result.percentTeamsRated).toBe(0);
    expect(result.warnings).toContain("NO_HISTORY");
  });

  it("averages the top half (by rating) of rated teams", () => {
    const result = computeFieldStrength(4, [
      { teamId: "a", nationalRank: 1, rating: 4, comparisons: 3 },
      { teamId: "b", nationalRank: 2, rating: 3, comparisons: 3 },
      { teamId: "c", nationalRank: 3, rating: 2, comparisons: 3 },
      { teamId: "d", nationalRank: 4, rating: 1, comparisons: 3 },
    ]);
    // top half by rating = a (4), b (3) -> mean 3.5
    expect(result.fss).toBeCloseTo(3.5, 10);
  });

  it("rounds the top-half count up for an odd number of rated teams", () => {
    const result = computeFieldStrength(3, [
      { teamId: "a", nationalRank: 1, rating: 6, comparisons: 2 },
      { teamId: "b", nationalRank: 2, rating: 3, comparisons: 2 },
      { teamId: "c", nationalRank: 3, rating: 0, comparisons: 2 },
    ]);
    // ceil(3/2) = 2 -> top half is a, b -> mean 4.5
    expect(result.fss).toBeCloseTo(4.5, 10);
  });

  it("counts rated teams into every bucket their national rank qualifies for", () => {
    const result = computeFieldStrength(3, [
      { teamId: "a", nationalRank: 3, rating: 5, comparisons: 1 },
      { teamId: "b", nationalRank: 20, rating: 4, comparisons: 1 },
      { teamId: "c", nationalRank: 300, rating: 3, comparisons: 1 },
    ]);
    expect(result.bucketCounts[5]).toBe(1);
    expect(result.bucketCounts[10]).toBe(1);
    expect(result.bucketCounts[25]).toBe(2);
    expect(result.bucketCounts[250]).toBe(2);
  });

  it("sums comparisons across rated teams for match volume", () => {
    const result = computeFieldStrength(2, [
      { teamId: "a", nationalRank: 1, rating: 5, comparisons: 4 },
      { teamId: "b", nationalRank: 2, rating: 4, comparisons: 6 },
    ]);
    expect(result.matchVolume).toBe(10);
  });

  it("flags SMALL_FIELD for a low team count regardless of rating coverage", () => {
    const result = computeFieldStrength(3, [
      { teamId: "a", nationalRank: 1, rating: 5, comparisons: 4 },
      { teamId: "b", nationalRank: 2, rating: 4, comparisons: 4 },
      { teamId: "c", nationalRank: 3, rating: 3, comparisons: 4 },
    ]);
    expect(result.warnings).toContain("SMALL_FIELD");
    expect(result.warnings).not.toContain("LOW_PERCENT_RATED");
  });

  it("flags LOW_PERCENT_RATED when less than half the field is rated", () => {
    const result = computeFieldStrength(10, [
      { teamId: "a", nationalRank: 1, rating: 5, comparisons: 4 },
      { teamId: "b", nationalRank: 2, rating: 4, comparisons: 4 },
    ]);
    expect(result.percentTeamsRated).toBeCloseTo(0.2, 10);
    expect(result.warnings).toContain("LOW_PERCENT_RATED");
  });

  it("does not flag LOW_PERCENT_RATED when NO_HISTORY already applies", () => {
    const result = computeFieldStrength(10, []);
    expect(result.warnings).not.toContain("LOW_PERCENT_RATED");
  });
});
