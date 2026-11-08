import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseTeamListXlsx } from "./parseTeamListXlsx";
import { averageRank, divisionAgeFromName, enginesDisagree, pickBestSeasonRow } from "./pure";
import { bandBoundaries, findNearTieClusters, sortForSeeding } from "./bands";
import { buildSeedingCsv } from "./exportSeeding";
import type { SeedingTeam } from "./types";

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Teams");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function team(rowNumber: number, avgRank: number | null, npsRank: number | null = null): SeedingTeam {
  return {
    rowNumber,
    fileTeamName: `T${rowNumber}`,
    fileClubName: "",
    city: "",
    state: "",
    code: `b18aaaaa${rowNumber}xx`,
    matchStatus: "MATCHED",
    teamId: `id${rowNumber}`,
    teamName: `T${rowNumber}`,
    clubName: null,
    ageGroup: 18,
    ratingSource: "current",
    ratingFromTeam: null,
    colleyRank: avgRank,
    eloRank: avgRank,
    masseyRank: avgRank,
    avgRank,
    npsRank,
    npsPoints: null,
    matchesPlayed: 6,
    distinctOpponents: 5,
    lastMatchDate: null,
    flags: [],
  };
}

describe("parseTeamListXlsx", () => {
  it("parses Sportwrench headers case-insensitively and flags duplicates", async () => {
    const buf = await xlsx([
      ["Team name", "division name", "USAV code", "Club name", "Director Email"],
      ["A", "18 Open", "B18SHARK1SO", "Sharks", "x@y.z"],
      ["B", "17 Open", "b18shark1so", "Sharks", "x@y.z"],
      [],
    ]);
    const r = await parseTeamListXlsx(buf);
    expect(r.fileError).toBeNull();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ teamName: "A", divisionName: "18 Open", code: "B18SHARK1SO", clubName: "Sharks" });
    expect(r.duplicateCodes).toEqual(["b18shark1so"]);
  });

  it("returns an error for missing required columns", async () => {
    const r = await parseTeamListXlsx(await xlsx([["Team name"], ["A"]]));
    expect(r.fileError).toMatch(/Division name/);
    expect(r.rows).toEqual([]);
  });

  it("returns an error for a non-xlsx file", async () => {
    const r = await parseTeamListXlsx(Buffer.from("not a workbook"));
    expect(r.fileError).toMatch(/xlsx/);
  });
});

describe("matching helpers", () => {
  it("prefers the report season, else the most recent", () => {
    const rows = [
      { seasonId: "s1", seasonStart: new Date("2024-10-01") },
      { seasonId: "s2", seasonStart: new Date("2025-10-01") },
    ];
    expect(pickBestSeasonRow(rows, "s1")?.seasonId).toBe("s1");
    expect(pickBestSeasonRow(rows, "s3")?.seasonId).toBe("s2");
  });
});

describe("report helpers", () => {
  it("reads division age and averages ranks", () => {
    expect(divisionAgeFromName("18 Open")).toBe(18);
    expect(divisionAgeFromName("Open")).toBeNull();
    expect(averageRank([10, null, 20])).toBe(15);
    expect(averageRank([null, null, null])).toBeNull();
  });
  it("flags engine disagreement only on a large spread", () => {
    expect(enginesDisagree([100, 105, 110])).toBe(false);
    expect(enginesDisagree([100, 400, null])).toBe(true);
    expect(enginesDisagree([5, null, null])).toBe(false);
  });
});

describe("bands", () => {
  it("sorts unrated teams last and respects the chosen key", () => {
    const teams = [team(1, null), team(2, 50, 1), team(3, 10, 9)];
    expect(sortForSeeding(teams, "avgRank").map((t) => t.rowNumber)).toEqual([3, 2, 1]);
    expect(sortForSeeding(teams, "nps").map((t) => t.rowNumber)).toEqual([2, 3, 1]);
  });
  it("chains near ties into clusters", () => {
    const sorted = [team(1, 10), team(2, 12), team(3, 14), team(4, 40), team(5, 80), team(6, 82)];
    expect(findNearTieClusters(sorted, 5)).toEqual([
      [0, 2],
      [4, 5],
    ]);
  });
  it("splits into near-equal bands and marks uncertain boundaries", () => {
    const clusters: [number, number][] = [[2, 4]];
    const b = bandBoundaries(10, 3, clusters);
    expect(b.map((x) => x.afterSeed)).toEqual([4, 7]);
    expect(b[0].uncertain).toBe(true); // seeds 4|5 straddle the cluster
    expect(b[1].uncertain).toBe(false);
  });
});

describe("csv", () => {
  it("emits a header, ordered seeds and quotes commas", () => {
    const a = team(1, 20);
    a.fileTeamName = "Club, A";
    const csv = buildSeedingCsv([{ name: "18 Open", teams: [a, team(2, 5)] }], "avgRank");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Suggested seed");
    expect(lines[1].split(",")[1]).toBe("1"); // team 2 is seed 1
    expect(lines[2]).toContain('"Club, A"');
  });
});
