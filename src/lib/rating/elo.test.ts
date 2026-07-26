import { describe, expect, it } from "vitest";
import { buildEloMatches, computeEloHistory, computeEloRatings, explainEloChange } from "./elo";

describe("buildEloMatches", () => {
  it("builds one EloMatch per completed match", () => {
    const matches = buildEloMatches([
      {
        id: "m1",
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: "m1", teamAId: "a", teamBId: "b", winnerTeamId: "a" });
  });

  it("skips a match with no resolved winner", () => {
    const matches = buildEloMatches([
      {
        id: "m1",
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: null,
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 1,
      },
    ]);
    expect(matches).toHaveLength(0);
  });

  it("skips a match with a null team side", () => {
    const matches = buildEloMatches([
      {
        id: "m1",
        teamAId: null,
        teamBId: "b",
        winnerTeamId: "b",
        matchDate: new Date("2026-01-01"),
        setsA: 0,
        setsB: 2,
      },
    ]);
    expect(matches).toHaveLength(0);
  });

  it("skips a match with no matchDate", () => {
    const matches = buildEloMatches([
      { id: "m1", teamAId: "a", teamBId: "b", winnerTeamId: "a", matchDate: null, setsA: 2, setsB: 0 },
    ]);
    expect(matches).toHaveLength(0);
  });
});

describe("computeEloRatings", () => {
  it("returns no ratings for an empty match list", () => {
    expect(computeEloRatings([])).toEqual([]);
  });

  it("rates the winner above the loser after a single match", () => {
    const ratings = computeEloRatings([
      {
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.rating]));
    expect(byId.get("a")!).toBeGreaterThan(1500);
    expect(byId.get("b")!).toBeLessThan(1500);
    // zero-sum: both start at 1500, so the gain/loss should mirror each other exactly.
    expect(byId.get("a")! - 1500).toBeCloseTo(1500 - byId.get("b")!, 10);
  });

  it("gives a bigger rating swing to a sweep than a narrow win, all else equal", () => {
    const sweep = computeEloRatings([
      {
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
    ]);
    const narrow = computeEloRatings([
      {
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 1,
      },
    ]);
    const sweepGain = sweep.find((r) => r.teamId === "a")!.rating - 1500;
    const narrowGain = narrow.find((r) => r.teamId === "a")!.rating - 1500;
    expect(sweepGain).toBeGreaterThan(narrowGain);
  });

  it("gives an upset win a bigger swing than a favorite's expected win", () => {
    // Warm up "a" as a strong favorite by beating a string of overmatched opponents.
    const warmup = ["b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((opp, i) => ({
      teamAId: "a",
      teamBId: opp,
      winnerTeamId: "a",
      matchDate: new Date(2026, 0, i + 1),
      setsA: 2,
      setsB: 0,
    }));
    const withFavoriteWin = computeEloRatings([
      ...warmup,
      {
        teamAId: "a",
        teamBId: "z",
        winnerTeamId: "a",
        matchDate: new Date(2026, 0, 20),
        setsA: 2,
        setsB: 0,
      },
    ]);
    const withUpsetLoss = computeEloRatings([
      ...warmup,
      {
        teamAId: "a",
        teamBId: "z",
        winnerTeamId: "z",
        matchDate: new Date(2026, 0, 20),
        setsA: 0,
        setsB: 2,
      },
    ]);
    const favoriteRating = withFavoriteWin.find((r) => r.teamId === "a")!.rating;
    const upsetLossRating = withUpsetLoss.find((r) => r.teamId === "a")!.rating;
    const priorRating = computeEloRatings(warmup).find((r) => r.teamId === "a")!.rating;
    // An expected win against a big underdog should barely move the rating; losing to
    // that same underdog should drop it sharply.
    expect(Math.abs(favoriteRating - priorRating)).toBeLessThan(Math.abs(upsetLossRating - priorRating));
  });

  it("uses a higher K for a team still under the provisional match threshold", () => {
    // "a" plays 11 matches against fresh opponents each time -- by the 11th match,
    // a's own count (10) is right at the provisional boundary, so the swing from that
    // match reflects PROVISIONAL_K one more time before dropping to BASE_K on the 12th.
    const opponents = Array.from({ length: 12 }, (_, i) => `opp${i}`);
    const matches = opponents.map((opp, i) => ({
      teamAId: "a",
      teamBId: opp,
      winnerTeamId: "a",
      matchDate: new Date(2026, 0, i + 1),
      setsA: 2,
      setsB: 0,
    }));
    const after10 = computeEloRatings(matches.slice(0, 10)).find((r) => r.teamId === "a")!.rating;
    const after11 = computeEloRatings(matches.slice(0, 11)).find((r) => r.teamId === "a")!.rating;
    const after12 = computeEloRatings(matches.slice(0, 12)).find((r) => r.teamId === "a")!.rating;
    const provisionalSwing = after11 - after10;
    const baseSwing = after12 - after11;
    expect(provisionalSwing).toBeGreaterThan(baseSwing);
  });

  it("tracks matchesPlayed per team", () => {
    const ratings = computeEloRatings([
      {
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
      {
        teamAId: "a",
        teamBId: "c",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-02"),
        setsA: 2,
        setsB: 0,
      },
    ]);
    const byId = new Map(ratings.map((r) => [r.teamId, r.matchesPlayed]));
    expect(byId.get("a")).toBe(2);
    expect(byId.get("b")).toBe(1);
    expect(byId.get("c")).toBe(1);
  });

  it("replays out of chronological input order the same as sorted order", () => {
    const inOrder = [
      {
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
      {
        teamAId: "b",
        teamBId: "c",
        winnerTeamId: "b",
        matchDate: new Date("2026-01-02"),
        setsA: 2,
        setsB: 1,
      },
    ];
    const shuffled = [inOrder[1], inOrder[0]];
    const a = computeEloRatings(inOrder);
    const b = computeEloRatings(shuffled);
    for (const r of a) {
      expect(r.rating).toBeCloseTo(b.find((x) => x.teamId === r.teamId)!.rating, 10);
    }
  });
});

describe("computeEloHistory", () => {
  it("returns no steps for an empty match list", () => {
    expect(computeEloHistory([])).toEqual([]);
  });

  it("returns one step per match, in chronological order regardless of input order", () => {
    const steps = computeEloHistory([
      {
        id: "m2",
        teamAId: "b",
        teamBId: "c",
        winnerTeamId: "b",
        matchDate: new Date("2026-01-02"),
        setsA: 2,
        setsB: 1,
      },
      {
        id: "m1",
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
    ]);
    expect(steps.map((s) => s.matchId)).toEqual(["m1", "m2"]);
  });

  it("agrees with computeEloRatings' final numbers", () => {
    const matches = [
      {
        id: "m1",
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
      {
        id: "m2",
        teamAId: "a",
        teamBId: "c",
        winnerTeamId: "c",
        matchDate: new Date("2026-01-02"),
        setsA: 1,
        setsB: 2,
      },
    ];
    const steps = computeEloHistory(matches);
    const finalARatingFromSteps = steps[steps.length - 1].ratingAAfter;
    const finalARatingFromRatings = computeEloRatings(matches).find((r) => r.teamId === "a")!.rating;
    expect(finalARatingFromSteps).toBeCloseTo(finalARatingFromRatings, 10);
  });

  it("carries a team's updated rating forward as its 'before' on its next match", () => {
    const steps = computeEloHistory([
      {
        id: "m1",
        teamAId: "a",
        teamBId: "b",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-01"),
        setsA: 2,
        setsB: 0,
      },
      {
        id: "m2",
        teamAId: "a",
        teamBId: "c",
        winnerTeamId: "a",
        matchDate: new Date("2026-01-02"),
        setsA: 2,
        setsB: 0,
      },
    ]);
    expect(steps[1].ratingABefore).toBeCloseTo(steps[0].ratingAAfter, 10);
  });
});

describe("explainEloChange", () => {
  it("notes a small gain for an expected win", () => {
    const text = explainEloChange({ won: true, expected: 0.9, multiplier: 1 });
    expect(text).toMatch(/expected to get/);
  });

  it("notes a significant jump for an upset win", () => {
    const text = explainEloChange({ won: true, expected: 0.1, multiplier: 1 });
    expect(text).toMatch(/upset win/);
  });

  it("notes a significant drop for an upset loss", () => {
    const text = explainEloChange({ won: false, expected: 0.9, multiplier: 1 });
    expect(text).toMatch(/upset loss/);
  });

  it("notes a small drop for an expected loss", () => {
    const text = explainEloChange({ won: false, expected: 0.1, multiplier: 1 });
    expect(text).toMatch(/expected/);
  });

  it("mentions the dominant margin on a lopsided favorite win", () => {
    const text = explainEloChange({ won: true, expected: 0.9, multiplier: 1.2 });
    expect(text).toMatch(/dominant margin/);
  });
});
