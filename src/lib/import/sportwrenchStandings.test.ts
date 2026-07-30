import { describe, expect, it, vi } from "vitest";
import { fetchSportwrenchStandingsRows } from "./sportwrenchStandings";

vi.mock("./sportwrenchFetch", () => ({
  fetchSportwrench: vi.fn(async (url: string) => {
    if (url.endsWith("/api/esw/c098ff439")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ long_name: "Test Event" }),
      };
    }
    if (url.endsWith("/api/esw/c098ff439/divisions")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => [
          { division_id: 111, name: "17U Div 5-20 Event #1" },
          { division_id: 222, name: "17U Div 1-4 Event #1" },
        ],
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
              {
                roster_team_id: 279897,
                team_name: "Tstreet LV 17-Chad",
                organization_code: "G17TSTLV1SC",
                club_name: "Tstreet Las Vegas",
                division_name: "17U Div 5-20 Event #1",
                rank: 1,
              },
              {
                roster_team_id: 280353,
                team_name: "No Code Team",
                // no organization_code -- should be skipped
                division_name: "17U Div 5-20 Event #1",
                rank: 2,
              },
              {
                // Real case: two teams tied for 3rd, `seed_current` came back 0 for
                // both (never re-seeded after elimination), but `rank` correctly
                // reflects the tie and the next team's rank skips to 5 -- confirmed
                // against a real event. Only `rank` is read here; seed_current isn't
                // part of the mocked response at all, so a regression back to reading
                // it would surface as `rank: "0"` failing this row.
                roster_team_id: 280354,
                team_name: "Tied Third Team",
                organization_code: "G17TIED31SC",
                division_name: "17U Div 5-20 Event #1",
                rank: 3,
              },
            ],
          },
        }),
      };
    }
    if (url.includes("/divisions/222/standings")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          teams: {
            "Div 1": [
              {
                roster_team_id: 243558,
                team_name: "Surfside 17 Legends Ashley",
                organization_code: "G17SRFSD2SC",
                division_name: "17U Div 1-4 Event #1",
                rank: 1,
              },
            ],
          },
        }),
      };
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  }),
}));

describe("fetchSportwrenchStandingsRows", () => {
  it("maps Sportwrench's event + standings responses into row shape across every division, flattening pool headings and using rank (not seed_current) as the finish", async () => {
    const result = await fetchSportwrenchStandingsRows("c098ff439");

    expect(result.eventName).toBe("Test Event");
    expect(result.skippedCount).toBe(1);
    expect(result.rows).toEqual([
      {
        rowNumber: 1,
        ageGroupLabel: "17U Div 5-20 Event #1",
        rank: "1",
        teamNameField: "Tstreet LV 17-Chad",
        teamCode: "G17TSTLV1SC",
        clubName: "Tstreet Las Vegas",
      },
      {
        rowNumber: 2,
        ageGroupLabel: "17U Div 5-20 Event #1",
        rank: "3",
        teamNameField: "Tied Third Team",
        teamCode: "G17TIED31SC",
        clubName: null,
      },
      {
        rowNumber: 3,
        ageGroupLabel: "17U Div 1-4 Event #1",
        rank: "1",
        teamNameField: "Surfside 17 Legends Ashley",
        teamCode: "G17SRFSD2SC",
        clubName: null,
      },
    ]);
  });
});
