import { describe, expect, it, vi } from "vitest";
import { fetchSportwrenchMatchResults } from "./sportwrenchMatches";

vi.mock("./sportwrenchFetch", () => ({
  fetchSportwrench: vi.fn(async (url: string) => {
    if (url.endsWith("/api/esw/c098ff439")) {
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ long_name: "Test Event" }) };
    }
    if (url.endsWith("/api/esw/c098ff439/divisions")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [{ division_id: 111, name: "17U Div 5-20" }],
      };
    }
    if (url.includes("/divisions/111/standings")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          teams: {
            "Div 5": [
              { roster_team_id: 279897, team_name: "Tstreet LV 17-Chad", organization_code: "G17TSTLV1SC" },
              { roster_team_id: 280272, team_name: "Reef 17 Dustin", organization_code: "G17REEFV1SC" },
            ],
          },
        }),
      };
    }
    if (url.includes("/teams/279897")) {
      // `matches` is nested inside `results[]` (one entry per pool/bracket played),
      // not top-level -- confirmed against real Sportwrench data.
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          results: [
            {
              matches: JSON.stringify([
                {
                  match_id: "f5a5c63b-d9b6-4de9-80f6-81efa06954e3",
                  match_type: "team1",
                  date_start: 1737363600000,
                  results: { set1: "20-25", set2: "25-23", set3: "15-9", winner: "1" },
                  division_id: 111,
                  pb_name: "Div 5 Pool 1",
                  opponent_team_name: "Reef 17 Dustin",
                  opponent_organization_code: "G17REEFV1SC",
                },
              ]),
            },
          ],
        }),
      };
    }
    if (url.includes("/teams/280272")) {
      // Same match, from the other participant's schedule -- should be de-duped.
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          results: [
            {
              matches: JSON.stringify([
                {
                  match_id: "f5a5c63b-d9b6-4de9-80f6-81efa06954e3",
                  match_type: "team2",
                  date_start: 1737363600000,
                  results: { set1: "20-25", set2: "25-23", set3: "15-9", winner: "1" },
                  division_id: 111,
                  pb_name: "Div 5 Pool 1",
                  opponent_team_name: "Tstreet LV 17-Chad",
                  opponent_organization_code: "G17TSTLV1SC",
                },
              ]),
            },
          ],
        }),
      };
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  }),
}));

describe("fetchSportwrenchMatchResults", () => {
  it("fetches standings to map team ids to codes, then de-dupes each match across both participants' match histories", async () => {
    const result = await fetchSportwrenchMatchResults("c098ff439");

    expect(result.eventName).toBe("Test Event");
    expect(result.matches).toEqual([
      {
        externalMatchId: "f5a5c63b-d9b6-4de9-80f6-81efa06954e3",
        divisionAesId: 111,
        divisionLabel: "Div 5 Pool 1",
        teamACode: "G17TSTLV1SC",
        teamAName: "Tstreet LV 17-Chad",
        teamBCode: "G17REEFV1SC",
        teamBName: "Reef 17 Dustin",
        winnerCode: "G17TSTLV1SC",
        sets: [
          { a: 20, b: 25 },
          { a: 25, b: 23 },
          { a: 15, b: 9 },
        ],
        setsA: 2,
        setsB: 1,
        matchDate: new Date(1737363600000),
        stage: "Div 5 Pool 1",
      },
    ]);
  });
});
