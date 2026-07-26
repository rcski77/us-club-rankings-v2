import { describe, expect, it, vi } from "vitest";
import { fetchAesStandingsRows } from "./aesStandings";

vi.mock("./aesFetch", () => ({
  fetchAes: vi.fn(async (url: string) => {
    if (url.includes("/api/event/")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          Name: "Test Event",
          Divisions: [
            { DivisionId: 111, Name: "14 Open" },
            { DivisionId: 222, Name: "14 American" },
          ],
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
            {
              TeamName: "MADFROG Green (NT) (1)",
              TeamCode: "g14frogs1nt",
              FinishRank: 1,
              Division: { Name: "14 Open" },
              Club: { ClubId: 1, Name: "MADFROG" },
            },
            {
              TeamName: "No Code Team (NT) (2)",
              // no TeamCode -- should be skipped
              FinishRank: 2,
              Division: { Name: "14 Open" },
            },
          ],
        }),
      };
    }
    if (url.includes("standings(dId=222")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          value: [
            {
              TeamName: "Some Other Team (SC) (1)",
              TeamCode: "g14other1sc",
              FinishRank: 1,
              Division: { Name: "14 American" },
            },
          ],
        }),
      };
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  }),
}));

describe("fetchAesStandingsRows", () => {
  it("maps AES's event + standings responses into row shape across every division, including the real club name", async () => {
    const result = await fetchAesStandingsRows("PTAwMDAwMzg4Mzk90");

    expect(result.eventName).toBe("Test Event");
    expect(result.skippedCount).toBe(1);
    expect(result.rows).toEqual([
      {
        rowNumber: 1,
        ageGroupLabel: "14 Open",
        rank: "1",
        teamNameField: "MADFROG Green (NT) (1)",
        teamCode: "g14frogs1nt",
        clubName: "MADFROG",
      },
      {
        rowNumber: 2,
        ageGroupLabel: "14 American",
        rank: "1",
        teamNameField: "Some Other Team (SC) (1)",
        teamCode: "g14other1sc",
        clubName: null,
      },
    ]);
  });
});
