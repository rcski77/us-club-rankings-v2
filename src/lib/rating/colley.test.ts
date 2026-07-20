import { describe, expect, it } from "vitest";
import { buildDivisionComparisons, solveColley } from "./colley";

describe("buildDivisionComparisons", () => {
  it("generates a comparison for every distinct-rank pair", () => {
    const comparisons = buildDivisionComparisons([
      { teamId: "a", rank: 1 },
      { teamId: "b", rank: 2 },
      { teamId: "c", rank: 3 },
    ]);
    expect(comparisons).toHaveLength(3);
    expect(comparisons).toContainEqual({ winnerTeamId: "a", loserTeamId: "b" });
    expect(comparisons).toContainEqual({ winnerTeamId: "a", loserTeamId: "c" });
    expect(comparisons).toContainEqual({ winnerTeamId: "b", loserTeamId: "c" });
  });

  it("produces no comparison between same-rank ties", () => {
    const comparisons = buildDivisionComparisons([
      { teamId: "a", rank: 1 },
      { teamId: "b", rank: 1 },
      { teamId: "c", rank: 3 },
    ]);
    expect(comparisons).toHaveLength(2);
    expect(comparisons).toContainEqual({ winnerTeamId: "a", loserTeamId: "c" });
    expect(comparisons).toContainEqual({ winnerTeamId: "b", loserTeamId: "c" });
  });
});

describe("solveColley", () => {
  it("returns no ratings for an empty comparison set", () => {
    expect(solveColley([])).toEqual([]);
  });

  it("ranks an undefeated team above a winless team in a simple chain", () => {
    // a beat b, b beat c -- a should rate highest, c lowest.
    const ratings = solveColley([
      { winnerTeamId: "a", loserTeamId: "b" },
      { winnerTeamId: "b", loserTeamId: "c" },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.rating]));
    expect(byId.get("a")!).toBeGreaterThan(byId.get("b")!);
    expect(byId.get("b")!).toBeGreaterThan(byId.get("c")!);
  });

  it("gives equal ratings to teams with symmetric records", () => {
    // a beat b, b beat c, c beat a: a perfect cycle, everyone 1-1.
    const ratings = solveColley([
      { winnerTeamId: "a", loserTeamId: "b" },
      { winnerTeamId: "b", loserTeamId: "c" },
      { winnerTeamId: "c", loserTeamId: "a" },
    ]);
    const values = ratings.map((r) => r.rating);
    expect(values[0]).toBeCloseTo(values[1], 10);
    expect(values[1]).toBeCloseTo(values[2], 10);
  });

  it("tracks comparisons per team", () => {
    const ratings = solveColley([
      { winnerTeamId: "a", loserTeamId: "b" },
      { winnerTeamId: "a", loserTeamId: "c" },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.comparisons]));
    expect(byId.get("a")).toBe(2);
    expect(byId.get("b")).toBe(1);
    expect(byId.get("c")).toBe(1);
  });

  it("connects two divisions through a shared team", () => {
    // Division 1: a beat b. Division 2: b beat c. a never played c directly, but
    // the shared team b should still connect the graph and separate their ratings.
    const ratings = solveColley([
      { winnerTeamId: "a", loserTeamId: "b" },
      { winnerTeamId: "b", loserTeamId: "c" },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.rating]));
    expect(byId.get("a")!).toBeGreaterThan(byId.get("c")!);
  });
});
