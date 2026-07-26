import { describe, expect, it } from "vitest";
import { resolveAesMatches, type MatchTeamSeasonRef } from "./resolveMatches";
import type { AesFetchedMatch } from "./aesMatches";

function fetchedMatch(overrides: Partial<AesFetchedMatch> = {}): AesFetchedMatch {
  return {
    externalMatchId: "111",
    divisionAesId: 999,
    divisionLabel: "14 Open",
    teamACode: "g14frogs1nt",
    teamAName: "MADFROG Green",
    teamBCode: "g14other1sc",
    teamBName: "Some Other Team",
    winnerCode: "g14frogs1nt",
    sets: [
      { a: 25, b: 20 },
      { a: 25, b: 18 },
    ],
    setsA: 2,
    setsB: 0,
    matchDate: new Date("2026-01-18T08:30:00"),
    stage: "Round 1 Pool C",
    ...overrides,
  };
}

describe("resolveAesMatches", () => {
  const teamSeasonByExternalCode = new Map<string, MatchTeamSeasonRef>([
    ["g14frogs1nt", { teamId: "team-a" }],
    ["g14other1sc", { teamId: "team-b" }],
  ]);
  const divisionIdByTeamId = new Map<string, string>([
    ["team-a", "div-1"],
    ["team-b", "div-1"],
  ]);

  it("resolves a match whose division and both teams already exist", () => {
    const { resolved, skipped } = resolveAesMatches([fetchedMatch()], teamSeasonByExternalCode, divisionIdByTeamId);

    expect(skipped).toEqual([]);
    expect(resolved).toEqual([
      {
        externalMatchId: "111",
        divisionId: "div-1",
        teamAId: "team-a",
        teamBId: "team-b",
        winnerTeamId: "team-a",
        matchDate: new Date("2026-01-18T08:30:00"),
        stage: "Round 1 Pool C",
        setsA: 2,
        setsB: 0,
        setScores: [
          { a: 25, b: 20 },
          { a: 25, b: 18 },
        ],
      },
    ]);
  });

  it("resolves the division from either team's finish -- e.g. when only teamB has one on file", () => {
    const oneTeamDivision = new Map<string, string>([["team-b", "div-1"]]);
    const { resolved, skipped } = resolveAesMatches([fetchedMatch()], teamSeasonByExternalCode, oneTeamDivision);

    expect(skipped).toEqual([]);
    expect(resolved[0].divisionId).toBe("div-1");
  });

  it("skips a match where neither team has a recorded finish for this event yet", () => {
    const { resolved, skipped } = resolveAesMatches([fetchedMatch()], teamSeasonByExternalCode, new Map());

    expect(resolved).toEqual([]);
    expect(skipped).toEqual([
      {
        externalMatchId: "111",
        reason: "Neither team has a recorded finish for this event yet — import team finishes for this event first.",
      },
    ]);
  });

  it("skips a match with an unresolved team code", () => {
    const { resolved, skipped } = resolveAesMatches(
      [fetchedMatch({ teamBCode: "g14unknown1sc", teamBName: "Unknown Team" })],
      teamSeasonByExternalCode,
      divisionIdByTeamId,
    );

    expect(resolved).toEqual([]);
    expect(skipped).toEqual([
      {
        externalMatchId: "111",
        reason: "Team(s) not resolved: Unknown Team — import team finishes for this event first.",
      },
    ]);
  });

  it("resolves winnerTeamId to null when winnerCode is null (unfinished/no-decision match)", () => {
    const { resolved } = resolveAesMatches(
      [fetchedMatch({ winnerCode: null })],
      teamSeasonByExternalCode,
      divisionIdByTeamId,
    );

    expect(resolved[0].winnerTeamId).toBeNull();
  });
});
