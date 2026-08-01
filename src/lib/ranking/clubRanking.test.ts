import { describe, expect, it } from "vitest";
import { computeClubScore, rankClubs, rankToPoints } from "./clubRanking";

describe("rankToPoints", () => {
  it("maps rank 1 to 100 and descends linearly with no floor", () => {
    expect(rankToPoints(1)).toBe(100);
    expect(rankToPoints(2)).toBe(99);
    expect(rankToPoints(5)).toBe(96);
    expect(rankToPoints(150)).toBe(-49);
  });

  it("gives tied ranks the same point value", () => {
    // two teams tied for 5th both carry RankingResult.rank = 5
    expect(rankToPoints(5)).toBe(rankToPoints(5));
  });
});

describe("computeClubScore", () => {
  it("is not qualified with fewer than 3 age groups in the top 100", () => {
    const result = computeClubScore({
      13: { teamId: "a", rank: 1 },
      14: { teamId: "b", rank: 5 },
    });
    expect(result.isQualified).toBe(false);
  });

  it("is qualified with 3+ age groups ranked in that age group's own top 100", () => {
    const result = computeClubScore({
      13: { teamId: "a", rank: 1 },
      14: { teamId: "b", rank: 50 },
      15: { teamId: "c", rank: 100 },
    });
    expect(result.isQualified).toBe(true);
  });

  it("does not count an age group ranked outside the top 100 toward qualification", () => {
    const result = computeClubScore({
      13: { teamId: "a", rank: 1 },
      14: { teamId: "b", rank: 50 },
      15: { teamId: "c", rank: 101 },
    });
    expect(result.isQualified).toBe(false);
  });

  it("treats a missing age group as an implicit 0 slot, always eligible to be dropped", () => {
    // only 5 of 6 age groups have a team; the missing slot should be the one dropped
    const result = computeClubScore({
      13: { teamId: "a", rank: 1 }, // 100 pts * .2 = 20
      14: { teamId: "b", rank: 1 }, // 20
      15: { teamId: "c", rank: 1 }, // 20
      16: { teamId: "d", rank: 1 }, // 20
      17: { teamId: "e", rank: 1 }, // 20
      // 18 missing -> 0, dropped
    });
    expect(result.totalPoints).toBeCloseTo(100, 10);
    const dropped = result.contributions.find((c) => !c.countedInBest5);
    expect(dropped?.ageGroup).toBe(18);
  });

  it("drops the single lowest weighted score among six real scores (best 5 of 6)", () => {
    const result = computeClubScore({
      13: { teamId: "a", rank: 1 }, // 100 -> 20
      14: { teamId: "b", rank: 2 }, // 99 -> 19.8
      15: { teamId: "c", rank: 3 }, // 98 -> 19.6
      16: { teamId: "d", rank: 4 }, // 97 -> 19.4
      17: { teamId: "e", rank: 5 }, // 96 -> 19.2
      18: { teamId: "f", rank: 50 }, // 51 -> 10.2 (lowest, dropped)
    });
    const dropped = result.contributions.find((c) => !c.countedInBest5);
    expect(dropped?.ageGroup).toBe(18);
    expect(result.totalPoints).toBeCloseTo(20 + 19.8 + 19.6 + 19.4 + 19.2, 10);
  });

  it("weights each age group's raw points at a flat 20%", () => {
    const result = computeClubScore({
      13: { teamId: "a", rank: 1 },
      14: { teamId: "b", rank: 1 },
      15: { teamId: "c", rank: 1 },
    });
    const contribution = result.contributions.find((c) => c.ageGroup === 13)!;
    expect(contribution.weightedPoints).toBeCloseTo(20, 10);
  });

  it("returns a zero score for a club with no ranked teams at all", () => {
    const result = computeClubScore({});
    expect(result.totalPoints).toBe(0);
    expect(result.isQualified).toBe(false);
    expect(result.contributions).toHaveLength(6);
    expect(result.contributions.every((c) => c.teamId === null)).toBe(true);
  });
});

describe("rankClubs", () => {
  it("sorts qualified clubs before under-qualified clubs regardless of raw score", () => {
    const ranked = rankClubs([
      { clubId: "weak-qualified", totalPoints: 10, isQualified: true, qualifyingAgeGroupCount: 3 },
      { clubId: "strong-unqualified", totalPoints: 90, isQualified: false, qualifyingAgeGroupCount: 1 },
    ]);
    expect(ranked.map((c) => c.clubId)).toEqual(["weak-qualified", "strong-unqualified"]);
  });

  it("orders the qualified tier by score descending and assigns a continuous rank across tiers", () => {
    const ranked = rankClubs([
      { clubId: "q-low", totalPoints: 10, isQualified: true, qualifyingAgeGroupCount: 3 },
      { clubId: "q-high", totalPoints: 50, isQualified: true, qualifyingAgeGroupCount: 4 },
      { clubId: "u-2", totalPoints: 5, isQualified: false, qualifyingAgeGroupCount: 2 },
      { clubId: "u-1", totalPoints: 90, isQualified: false, qualifyingAgeGroupCount: 1 },
    ]);
    expect(ranked.map((c) => ({ clubId: c.clubId, rank: c.rank }))).toEqual([
      { clubId: "q-high", rank: 1 },
      { clubId: "q-low", rank: 2 },
      { clubId: "u-2", rank: 3 },
      { clubId: "u-1", rank: 4 },
    ]);
  });

  it("orders the under-qualified tier by qualifying age-group count before score", () => {
    // u-1-high has a much higher score, but fewer top-100 age groups -- count wins
    const ranked = rankClubs([
      { clubId: "u-1-high", totalPoints: 90, isQualified: false, qualifyingAgeGroupCount: 1 },
      { clubId: "u-2-low", totalPoints: 20, isQualified: false, qualifyingAgeGroupCount: 2 },
      { clubId: "u-0", totalPoints: 5, isQualified: false, qualifyingAgeGroupCount: 0 },
    ]);
    expect(ranked.map((c) => c.clubId)).toEqual(["u-2-low", "u-1-high", "u-0"]);
  });

  it("breaks ties within the same qualifying count by score", () => {
    const ranked = rankClubs([
      { clubId: "u-2-low", totalPoints: 20, isQualified: false, qualifyingAgeGroupCount: 2 },
      { clubId: "u-2-high", totalPoints: 40, isQualified: false, qualifyingAgeGroupCount: 2 },
    ]);
    expect(ranked.map((c) => c.clubId)).toEqual(["u-2-high", "u-2-low"]);
  });
});
