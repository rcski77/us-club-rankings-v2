import { describe, expect, it, vi } from "vitest";
import { fetchAesMatchResults } from "./aesMatches";

vi.mock("./aesFetch", () => ({
  fetchAes: vi.fn(async (url: string) => {
    if (url.includes("/api/event/PTAwMDAwMzg4Mzk90") && !url.includes("/division/")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          Name: "Test Event",
          Divisions: [{ DivisionId: 111, Name: "14 Open" }],
        }),
      };
    }
    if (url.includes("standings(dId=111")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          value: [
            { TeamId: 9711, TeamCode: "g14frogs1nt", Division: { Name: "14 Open" } },
            { TeamId: 84577, TeamCode: "g14other1sc", Division: { Name: "14 Open" } },
          ],
        }),
      };
    }
    if (url.includes("/division/111/team/9711/schedule/past")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            Match: {
              MatchId: -52087,
              FirstTeamId: 9711,
              FirstTeamName: "MADFROG Green",
              FirstTeamWon: true,
              SecondTeamId: 84577,
              SecondTeamName: "Some Other Team",
              HasScores: true,
              Sets: [
                { FirstTeamScore: 25, SecondTeamScore: 20 },
                { FirstTeamScore: 25, SecondTeamScore: 18 },
                { FirstTeamScore: null, SecondTeamScore: null },
              ],
              ScheduledStartDateTime: "2026-01-18T08:30:00",
            },
            Play: { FullName: "Round 1 Pool C" },
          },
        ],
      };
    }
    if (url.includes("/division/111/team/84577/schedule/past")) {
      // Same match, from the other participant's schedule -- should be de-duped.
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          {
            Match: {
              MatchId: -52087,
              FirstTeamId: 9711,
              FirstTeamName: "MADFROG Green",
              FirstTeamWon: true,
              SecondTeamId: 84577,
              SecondTeamName: "Some Other Team",
              HasScores: true,
              Sets: [
                { FirstTeamScore: 25, SecondTeamScore: 20 },
                { FirstTeamScore: 25, SecondTeamScore: 18 },
              ],
              ScheduledStartDateTime: "2026-01-18T08:30:00",
            },
            Play: { FullName: "Round 1 Pool C" },
          },
        ],
      };
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  }),
}));

describe("fetchAesMatchResults", () => {
  it("fetches standings to map team ids to codes, then de-dupes each match across both participants' past schedules", async () => {
    const result = await fetchAesMatchResults("PTAwMDAwMzg4Mzk90");

    expect(result.eventName).toBe("Test Event");
    expect(result.matches).toEqual([
      {
        externalMatchId: "-52087",
        divisionAesId: 111,
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
      },
    ]);
  });
});
