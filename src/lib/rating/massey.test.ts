import { describe, expect, it } from "vitest";
import { buildMasseyMatches, computeMatchPointDiff, solveMassey } from "./massey";

describe("computeMatchPointDiff", () => {
  it("sums each set's (a - b) across the whole match", () => {
    // 25-20, 22-25, 15-10 -- a 3-set match, not just the deciding set.
    expect(
      computeMatchPointDiff([
        { a: 25, b: 20 },
        { a: 22, b: 25 },
        { a: 15, b: 10 },
      ]),
    ).toBe(5 + -3 + 5);
  });

  it("returns 0 for no sets", () => {
    expect(computeMatchPointDiff([])).toBe(0);
  });
});

describe("buildMasseyMatches", () => {
  it("computes pointDiff per match from real set scores", () => {
    const matches = buildMasseyMatches([
      {
        teamAId: "a",
        teamBId: "b",
        setScores: [
          { a: 25, b: 21 },
          { a: 25, b: 18 },
        ],
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ teamAId: "a", teamBId: "b", pointDiff: 11 });
  });

  it("skips matches with a null team side", () => {
    const matches = buildMasseyMatches([
      { teamAId: null, teamBId: "b", setScores: [{ a: 25, b: 20 }] },
      { teamAId: "a", teamBId: null, setScores: [{ a: 25, b: 20 }] },
    ]);
    expect(matches).toHaveLength(0);
  });

  it("skips matches with no recorded set scores", () => {
    const matches = buildMasseyMatches([{ teamAId: "a", teamBId: "b", setScores: [] }]);
    expect(matches).toHaveLength(0);
  });

  it("passes divisionWeight through as-is", () => {
    const matches = buildMasseyMatches([
      { teamAId: "a", teamBId: "b", setScores: [{ a: 25, b: 20 }], divisionWeight: 1.4 },
    ]);
    expect(matches[0].divisionWeight).toBe(1.4);
  });
});

describe("solveMassey", () => {
  it("returns no ratings for an empty match set", () => {
    expect(solveMassey([])).toEqual([]);
  });

  it("ranks the team with the larger point differential higher", () => {
    const ratings = solveMassey([
      { teamAId: "a", teamBId: "b", pointDiff: 20 },
      { teamAId: "b", teamBId: "c", pointDiff: 20 },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.rating]));
    expect(byId.get("a")!).toBeGreaterThan(byId.get("b")!);
    expect(byId.get("b")!).toBeGreaterThan(byId.get("c")!);
  });

  it("gives equal ratings to teams with symmetric point differentials", () => {
    // a beat b by 10, b beat c by 10, c beat a by 10 -- a perfectly symmetric cycle.
    const ratings = solveMassey([
      { teamAId: "a", teamBId: "b", pointDiff: 10 },
      { teamAId: "b", teamBId: "c", pointDiff: 10 },
      { teamAId: "c", teamBId: "a", pointDiff: 10 },
    ]);
    const values = ratings.map((r) => r.rating);
    expect(values[0]).toBeCloseTo(values[1], 10);
    expect(values[1]).toBeCloseTo(values[2], 10);
  });

  it("tracks games played (comparisons) per team", () => {
    const ratings = solveMassey([
      { teamAId: "a", teamBId: "b", pointDiff: 5 },
      { teamAId: "a", teamBId: "c", pointDiff: 5 },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.comparisons]));
    expect(byId.get("a")).toBe(2);
    expect(byId.get("b")).toBe(1);
    expect(byId.get("c")).toBe(1);
  });

  it("solves a small isolated pair without a singular-matrix error, pulled toward 0 by ridge", () => {
    // A lone disconnected pair -- the Massey matrix here is exactly singular before
    // ridge regularization (2 teams, rows sum to zero); ridge must make it solvable.
    const ratings = solveMassey([{ teamAId: "a", teamBId: "b", pointDiff: 8 }]);
    expect(ratings).toHaveLength(2);
    const byId = new Map(ratings.map((r) => [r.teamId, r.rating]));
    expect(byId.get("a")!).toBeGreaterThan(byId.get("b")!);
    // Symmetric around a small magnitude rather than diverging to +/-Infinity.
    expect(Math.abs(byId.get("a")!)).toBeLessThan(100);
    expect(byId.get("a")! + byId.get("b")!).toBeCloseTo(0, 10);
  });

  it("omitting divisionWeight behaves identically to divisionWeight: 1", () => {
    const base = { teamAId: "a", teamBId: "b", pointDiff: 8 };
    const omitted = solveMassey([base]);
    const explicit = solveMassey([{ ...base, divisionWeight: 1 }]);
    expect(omitted.find((r) => r.teamId === "a")!.rating).toBeCloseTo(
      explicit.find((r) => r.teamId === "a")!.rating,
      10,
    );
  });

  it("gives a bigger rating swing to a higher divisionWeight, all else equal", () => {
    // Same connected 3-team graph as the ranking test above, but "a" vs "b"'s match is
    // scaled by a higher divisionWeight -- that match's own differential should end up
    // asserting more influence on the solve.
    const neutral = solveMassey([
      { teamAId: "a", teamBId: "b", pointDiff: 20 },
      { teamAId: "b", teamBId: "c", pointDiff: 5 },
    ]);
    const weighted = solveMassey([
      { teamAId: "a", teamBId: "b", pointDiff: 20, divisionWeight: 3 },
      { teamAId: "b", teamBId: "c", pointDiff: 5 },
    ]);
    const neutralGap = neutral.find((r) => r.teamId === "a")!.rating - neutral.find((r) => r.teamId === "b")!.rating;
    const weightedGap =
      weighted.find((r) => r.teamId === "a")!.rating - weighted.find((r) => r.teamId === "b")!.rating;
    expect(weightedGap).toBeGreaterThan(neutralGap);
  });

  it("still gives equal ratings for a symmetric cycle when every match shares the same divisionWeight", () => {
    // Uniformly scaling every match by the same weight shouldn't break the
    // symmetric-cycle property verified above with weight 1.
    const ratings = solveMassey([
      { teamAId: "a", teamBId: "b", pointDiff: 10, divisionWeight: 1.5 },
      { teamAId: "b", teamBId: "c", pointDiff: 10, divisionWeight: 1.5 },
      { teamAId: "c", teamBId: "a", pointDiff: 10, divisionWeight: 1.5 },
    ]);
    const values = ratings.map((r) => r.rating);
    expect(values[0]).toBeCloseTo(values[1], 10);
    expect(values[1]).toBeCloseTo(values[2], 10);
  });
});
