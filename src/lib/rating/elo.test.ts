import { describe, expect, it } from "vitest";
import {
  buildEloMatches,
  classifyOpponentStrength,
  classifyResult,
  computeEloHistory,
  computeEloRatings,
  computeMatchPointDiffRatio,
  DEFAULT_ELO_CONFIG,
  explainDivisionEffect,
  explainEloChange,
  OPEN_DIVISION_LOSS_SOFTEN,
  OPEN_DIVISION_WIN_BONUS,
} from "./elo";

describe("computeMatchPointDiffRatio", () => {
  it("returns 0 for no sets", () => {
    expect(computeMatchPointDiffRatio([])).toBe(0);
  });

  it("returns 0 for a match with equal total points despite an uneven set split", () => {
    // 20-25, 25-22, 16-14: (20-25)+(25-22)+(16-14) = -5+3+2 = 0
    const ratio = computeMatchPointDiffRatio([
      { a: 20, b: 25 },
      { a: 25, b: 22 },
      { a: 16, b: 14 },
    ]);
    expect(ratio).toBeCloseTo(0, 10);
  });

  it("returns a high ratio for a near-shutout", () => {
    const ratio = computeMatchPointDiffRatio([
      { a: 25, b: 2 },
      { a: 25, b: 3 },
    ]);
    expect(ratio).toBeGreaterThan(0.7);
  });

  it("is symmetric regardless of which side is ahead", () => {
    const aAhead = computeMatchPointDiffRatio([{ a: 25, b: 15 }]);
    const bAhead = computeMatchPointDiffRatio([{ a: 15, b: 25 }]);
    expect(aAhead).toBeCloseTo(bAhead, 10);
  });
});

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
    // "a" plays fresh opponents each time -- derived from DEFAULT_ELO_CONFIG's actual
    // threshold (not hardcoded) so this test stays correct if that constant is
    // recalibrated. By the (threshold+1)th match, a's own count (== threshold) is
    // right at the provisional boundary, so that match's swing reflects PROVISIONAL_K
    // one more time before dropping to BASE_K on the (threshold+2)th.
    const threshold = DEFAULT_ELO_CONFIG.provisionalMatchThreshold;
    const opponents = Array.from({ length: threshold + 2 }, (_, i) => `opp${i}`);
    const matches = opponents.map((opp, i) => ({
      teamAId: "a",
      teamBId: opp,
      winnerTeamId: "a",
      matchDate: new Date(2026, 0, i + 1),
      setsA: 2,
      setsB: 0,
    }));
    const afterThreshold = computeEloRatings(matches.slice(0, threshold)).find((r) => r.teamId === "a")!.rating;
    const afterThresholdPlus1 = computeEloRatings(matches.slice(0, threshold + 1)).find(
      (r) => r.teamId === "a",
    )!.rating;
    const afterThresholdPlus2 = computeEloRatings(matches.slice(0, threshold + 2)).find(
      (r) => r.teamId === "a",
    )!.rating;
    const provisionalSwing = afterThresholdPlus1 - afterThreshold;
    const baseSwing = afterThresholdPlus2 - afterThresholdPlus1;
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

  it("gives a bigger rating swing to a higher divisionWeight, all else equal", () => {
    const base = {
      teamAId: "a",
      teamBId: "b",
      winnerTeamId: "a",
      matchDate: new Date("2026-01-01"),
      setsA: 2,
      setsB: 0,
    };
    const weighted = computeEloRatings([{ ...base, divisionWeight: 1.6 }]);
    const neutral = computeEloRatings([{ ...base, divisionWeight: 1 }]);
    const weightedGain = weighted.find((r) => r.teamId === "a")!.rating - 1500;
    const neutralGain = neutral.find((r) => r.teamId === "a")!.rating - 1500;
    expect(weightedGain).toBeCloseTo(neutralGain * 1.6, 10);
  });

  it("omitting divisionWeight behaves identically to divisionWeight: 1", () => {
    const base = {
      teamAId: "a",
      teamBId: "b",
      winnerTeamId: "a",
      matchDate: new Date("2026-01-01"),
      setsA: 2,
      setsB: 0,
    };
    const omitted = computeEloRatings([base]);
    const explicit = computeEloRatings([{ ...base, divisionWeight: 1 }]);
    expect(omitted.find((r) => r.teamId === "a")!.rating).toBeCloseTo(
      explicit.find((r) => r.teamId === "a")!.rating,
      10,
    );
  });

  it("softens (not amplifies) the loser's rating drop in an above-average-weight division", () => {
    const base = {
      teamAId: "a",
      teamBId: "b",
      winnerTeamId: "a", // b loses
      matchDate: new Date("2026-01-01"),
      setsA: 2,
      setsB: 0,
    };
    const weighted = computeEloRatings([{ ...base, divisionWeight: 1.6 }]);
    const neutral = computeEloRatings([{ ...base, divisionWeight: 1 }]);
    const weightedLossDrop = 1500 - weighted.find((r) => r.teamId === "b")!.rating;
    const neutralLossDrop = 1500 - neutral.find((r) => r.teamId === "b")!.rating;
    // Softened by the weight's reciprocal (1/1.6), not amplified by the weight itself.
    expect(weightedLossDrop).toBeCloseTo(neutralLossDrop / 1.6, 10);
    expect(weightedLossDrop).toBeLessThan(neutralLossDrop);
  });

  it("keeps below-average-weight divisions symmetric for both win and loss", () => {
    const base = {
      teamAId: "a",
      teamBId: "b",
      winnerTeamId: "a",
      matchDate: new Date("2026-01-01"),
      setsA: 2,
      setsB: 0,
    };
    const weighted = computeEloRatings([{ ...base, divisionWeight: 0.7 }]);
    const neutral = computeEloRatings([{ ...base, divisionWeight: 1 }]);
    const winGain = weighted.find((r) => r.teamId === "a")!.rating - 1500;
    const lossDrop = 1500 - weighted.find((r) => r.teamId === "b")!.rating;
    const neutralGain = neutral.find((r) => r.teamId === "a")!.rating - 1500;
    expect(winGain).toBeCloseTo(neutralGain * 0.7, 10);
    expect(lossDrop).toBeCloseTo(neutralGain * 0.7, 10); // same magnitude as the win, symmetric
  });

  it("applies the Open-division bonus on top of divisionWeight, directionally", () => {
    const base = {
      teamAId: "a",
      teamBId: "b",
      winnerTeamId: "a",
      matchDate: new Date("2026-01-01"),
      setsA: 2,
      setsB: 0,
      divisionWeight: 1.6,
    };
    const open = computeEloRatings([{ ...base, isOpenDivision: true }]);
    const nonOpen = computeEloRatings([{ ...base, isOpenDivision: false }]);
    const openWinGain = open.find((r) => r.teamId === "a")!.rating - 1500;
    const nonOpenWinGain = nonOpen.find((r) => r.teamId === "a")!.rating - 1500;
    expect(openWinGain).toBeCloseTo(nonOpenWinGain * OPEN_DIVISION_WIN_BONUS, 10);

    const openLossDrop = 1500 - open.find((r) => r.teamId === "b")!.rating;
    const nonOpenLossDrop = 1500 - nonOpen.find((r) => r.teamId === "b")!.rating;
    expect(openLossDrop).toBeCloseTo(nonOpenLossDrop * OPEN_DIVISION_LOSS_SOFTEN, 10);
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

describe("marginMultiplier (via computeEloHistory)", () => {
  const base = {
    id: "m1",
    teamAId: "a",
    teamBId: "b",
    winnerTeamId: "a",
    matchDate: new Date("2026-01-01"),
    setsA: 2,
    setsB: 1,
  };

  it("gives a lower multiplier to a dead-even split than a decisive one, both 2-1", () => {
    const nailBiter = computeEloHistory([
      {
        ...base,
        setScores: [
          { a: 20, b: 25 },
          { a: 25, b: 22 },
          { a: 16, b: 14 },
        ],
      },
    ]);
    const decisive = computeEloHistory([
      {
        ...base,
        setScores: [
          { a: 25, b: 10 },
          { a: 20, b: 25 },
          { a: 15, b: 5 },
        ],
      },
    ]);
    expect(nailBiter[0].multiplier).toBeLessThan(decisive[0].multiplier);
  });

  it("falls back to the old set-fraction-only multiplier when no setScores are given", () => {
    // marginStrength: 1 pinned explicitly -- this test isolates the raw setComponent
    // formula itself, independent of whatever marginStrength the current calibrated
    // default happens to be (see DEFAULT_ELO_CONFIG in elo.ts).
    const withoutScores = computeEloHistory([base], { ...DEFAULT_ELO_CONFIG, marginStrength: 1 });
    // Same as the pre-existing set-fraction formula: 0.8 + 0.4 * (2/3)
    expect(withoutScores[0].multiplier).toBeCloseTo(0.8 + 0.4 * (2 / 3), 10);
  });

  it("a 2-1 nail-biter with zero net point differential can classify as narrow", () => {
    const nailBiter = computeEloHistory([
      {
        ...base,
        setScores: [
          { a: 20, b: 25 },
          { a: 25, b: 22 },
          { a: 16, b: 14 },
        ],
      },
    ]);
    expect(nailBiter[0].multiplier).toBeLessThanOrEqual(0.95);
  });

  it("gives a bigger multiplier to a lopsided sweep than a close one", () => {
    const close = computeEloHistory([
      {
        ...base,
        setsA: 2,
        setsB: 0,
        winnerTeamId: "a",
        setScores: [
          { a: 26, b: 24 },
          { a: 26, b: 24 },
        ],
      },
    ]);
    const blowout = computeEloHistory([
      {
        ...base,
        setsA: 2,
        setsB: 0,
        winnerTeamId: "a",
        setScores: [
          { a: 25, b: 10 },
          { a: 25, b: 8 },
        ],
      },
    ]);
    expect(close[0].multiplier).toBeLessThan(blowout[0].multiplier);
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

describe("classifyResult", () => {
  it("labels a dominant win with its point gain", () => {
    expect(classifyResult({ won: true, multiplier: 1.2, delta: 17 })).toBe("Dominant Win (+17 pts)");
  });

  it("labels a narrow loss with its point loss", () => {
    expect(classifyResult({ won: false, multiplier: 0.85, delta: -8 })).toBe("Narrow Loss (-8 pts)");
  });

  it("labels a moderate-margin result", () => {
    expect(classifyResult({ won: true, multiplier: 1.0, delta: 12 })).toBe("Moderate Win (+12 pts)");
  });
});

describe("classifyOpponentStrength", () => {
  it("classifies a lopsided expectation as much weaker/stronger", () => {
    expect(classifyOpponentStrength(0.97)).toBe("much weaker");
    expect(classifyOpponentStrength(0.03)).toBe("much stronger");
  });

  it("classifies a moderate favorite/underdog gap", () => {
    expect(classifyOpponentStrength(0.7)).toBe("weaker");
    expect(classifyOpponentStrength(0.3)).toBe("stronger");
  });

  it("classifies a near-even matchup", () => {
    expect(classifyOpponentStrength(0.5)).toBe("evenly matched");
  });
});

describe("explainDivisionEffect", () => {
  it("returns null for a neutral, non-Open division", () => {
    expect(explainDivisionEffect({ won: true, divisionWeight: 1, isOpenDivision: false })).toBeNull();
  });

  it("describes a win in a strong, Open division", () => {
    const text = explainDivisionEffect({ won: true, divisionWeight: 1.6, isOpenDivision: true });
    expect(text).toMatch(/Open division/);
    expect(text).toMatch(/1\.60x/);
    expect(text).toMatch(/count for more/);
  });

  it("describes a loss in a strong division as softened, not amplified", () => {
    const text = explainDivisionEffect({ won: false, divisionWeight: 1.6, isOpenDivision: false });
    expect(text).toMatch(/softened instead of amplified/);
  });

  it("describes a below-average division as counting less either way", () => {
    const winText = explainDivisionEffect({ won: true, divisionWeight: 0.7, isOpenDivision: false });
    const lossText = explainDivisionEffect({ won: false, divisionWeight: 0.7, isOpenDivision: false });
    expect(winText).toMatch(/counted for less either way/);
    expect(lossText).toMatch(/counted for less either way/);
  });
});

describe("EloConfig", () => {
  const base = {
    teamAId: "a",
    teamBId: "b",
    winnerTeamId: "a",
    matchDate: new Date("2026-01-01"),
    setsA: 2,
    setsB: 1,
  };

  it("omitting config reproduces DEFAULT_ELO_CONFIG's exact output", () => {
    const omitted = computeEloRatings([base]);
    const explicit = computeEloRatings([base], DEFAULT_ELO_CONFIG);
    expect(omitted.find((r) => r.teamId === "a")!.rating).toBeCloseTo(
      explicit.find((r) => r.teamId === "a")!.rating,
      10,
    );
  });

  it("a baseK override changes the swing for a warmed-up (non-provisional) team", () => {
    // Warm both teams up past the provisional threshold first (derived from
    // DEFAULT_ELO_CONFIG, not hardcoded, so this stays correct if that constant is
    // recalibrated), so the final match uses baseK, not provisionalK.
    const threshold = DEFAULT_ELO_CONFIG.provisionalMatchThreshold;
    const warmup = Array.from({ length: threshold }, (_, i) => ({
      teamAId: "a",
      teamBId: `opp${i}`,
      winnerTeamId: "a",
      matchDate: new Date(2026, 0, i + 1),
      setsA: 2,
      setsB: 0,
    })).concat(
      Array.from({ length: threshold }, (_, i) => ({
        teamAId: "b",
        teamBId: `bopp${i}`,
        winnerTeamId: "b",
        matchDate: new Date(2026, 0, i + 1),
        setsA: 2,
        setsB: 0,
      })),
    );
    const decisive = { ...base, matchDate: new Date(2026, 0, threshold + 10) };

    const defaultRating = computeEloRatings([...warmup, decisive]).find((r) => r.teamId === "a")!.rating;
    const highK = computeEloRatings(
      [...warmup, decisive],
      { ...DEFAULT_ELO_CONFIG, baseK: DEFAULT_ELO_CONFIG.baseK * 2 },
    ).find((r) => r.teamId === "a")!.rating;
    const priorRating = computeEloRatings(warmup).find((r) => r.teamId === "a")!.rating;

    expect(Math.abs(highK - priorRating)).toBeCloseTo(2 * Math.abs(defaultRating - priorRating), 6);
  });

  it("marginStrength: 0 makes the multiplier always 1 regardless of set/point scores", () => {
    const steps = computeEloHistory(
      [
        {
          id: "m1",
          ...base,
          setScores: [
            { a: 25, b: 5 },
            { a: 25, b: 3 },
          ],
        },
      ],
      { ...DEFAULT_ELO_CONFIG, marginStrength: 0 },
    );
    expect(steps[0].multiplier).toBe(1);
  });

  describe("3-tier K (provisional -> mid -> veteran/base)", () => {
    // "a" plays fresh opponents, each a clean sweep so K is the only thing that varies
    // the swing (multiplier pinned by set fraction, no divisionWeight/openBonus in
    // play). Every match is scored via a single replay (not one computeEloRatings call
    // per prefix) so each step's ratingABefore is exactly the running rating -- the
    // same replay production itself does.
    function buildMatches(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `m${i}`,
        teamAId: "a",
        teamBId: `opp${i}`,
        winnerTeamId: "a",
        matchDate: new Date(2026, 0, i + 1),
        setsA: 2,
        setsB: 0,
      }));
    }

    it("a team past provisionalMatchThreshold but before veteranMatchThreshold uses midK, not baseK", () => {
      const config = {
        ...DEFAULT_ELO_CONFIG,
        provisionalMatchThreshold: 5,
        midK: 32,
        veteranMatchThreshold: 15,
        baseK: 24,
      };
      const steps = computeEloHistory(buildMatches(20), config);
      // a's 10th match (index 9): a has played 9 prior matches -- past the
      // provisional threshold (5), short of the veteran threshold (15) -- so this
      // step's kA should be midK, not provisionalK or baseK.
      expect(steps[9].kA).toBe(32);
      // a's 3rd match (index 2): a has played 2 prior matches, still provisional.
      expect(steps[2].kA).toBe(config.provisionalK);
      // a's 18th match (index 17): a has played 17 prior matches, past veteran threshold.
      expect(steps[17].kA).toBe(24);
    });

    it("defaults (veteranMatchThreshold == provisionalMatchThreshold) collapse the mid tier -- no team ever sees midK", () => {
      // Derived from the real default threshold (not hardcoded) so this stays correct
      // if that constant is recalibrated -- enough matches to cross it plus a margin.
      const matches = buildMatches(DEFAULT_ELO_CONFIG.provisionalMatchThreshold + 10);
      const steps = computeEloHistory(matches, DEFAULT_ELO_CONFIG);
      const kValuesSeen = new Set(steps.map((s) => s.kA));
      expect(kValuesSeen).toEqual(new Set([DEFAULT_ELO_CONFIG.provisionalK, DEFAULT_ELO_CONFIG.baseK]));
    });
  });
});
