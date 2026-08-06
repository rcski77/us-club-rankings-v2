import { describe, expect, it } from "vitest";
import { computeFiveYearClubScore, rankFiveYearClubs } from "./fiveYearClubRanking";

const YEARS = [2021, 2022, 2023, 2024, 2025];

describe("computeFiveYearClubScore", () => {
  it("matches the source workbook's real computed total for A5/Mizuno", () => {
    // Real numbers from "Prev Rankings for 5 Yr Calc" (2021-2024) + "2025 Rankings"
    // (2025), cross-checked against the workbook's own "5 Year Ranking" tab, which
    // computed 89.375 for this exact club.
    const result = computeFiveYearClubScore(
      { 2021: 94.1, 2022: 86, 2023: 87.2, 2024: 83.2, 2025: 95.80000000000001 },
      YEARS,
    );
    expect(result.totalPoints).toBe(89.4);
  });

  it("applies weights oldest (5%) to newest (35%)", () => {
    const result = computeFiveYearClubScore(
      { 2021: 100, 2022: 100, 2023: 100, 2024: 100, 2025: 100 },
      YEARS,
    );
    expect(result.contributions.map((c) => c.weight)).toEqual([0.05, 0.15, 0.2, 0.25, 0.35]);
    expect(result.totalPoints).toBe(100);
  });

  it("treats a missing year as 0 contribution, not a renormalized weight", () => {
    const withGap = computeFiveYearClubScore({ 2022: 100, 2023: 100, 2024: 100, 2025: 100 }, YEARS);
    const complete = computeFiveYearClubScore(
      { 2021: 100, 2022: 100, 2023: 100, 2024: 100, 2025: 100 },
      YEARS,
    );
    expect(withGap.totalPoints).toBe(95); // 100 - 5% missing, not still 100
    expect(withGap.totalPoints).toBeLessThan(complete.totalPoints);
    expect(withGap.contributions[0]).toMatchObject({ year: 2021, points: 0, present: false });
  });

  it("throws if not given exactly 5 years", () => {
    expect(() => computeFiveYearClubScore({}, [2021, 2022])).toThrow();
  });
});

describe("rankFiveYearClubs", () => {
  it("orders by totalPoints descending", () => {
    const ranked = rankFiveYearClubs([
      { clubId: "a", totalPoints: 50 },
      { clubId: "b", totalPoints: 90 },
      { clubId: "c", totalPoints: 70 },
    ]);
    expect(ranked.map((r) => r.clubId)).toEqual(["b", "c", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("gives tied totals the same rank and skips the next rank accordingly", () => {
    const ranked = rankFiveYearClubs([
      { clubId: "a", totalPoints: 90 },
      { clubId: "b", totalPoints: 90 },
      { clubId: "c", totalPoints: 80 },
    ]);
    expect(ranked.find((r) => r.clubId === "a")!.rank).toBe(1);
    expect(ranked.find((r) => r.clubId === "b")!.rank).toBe(1);
    expect(ranked.find((r) => r.clubId === "c")!.rank).toBe(3);
  });
});
