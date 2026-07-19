import { describe, expect, it } from "vitest";
import { parseAesCsv } from "./aesCsv";

describe("parseAesCsv", () => {
  it("parses a header-based file with the documented column names", () => {
    const csv = [
      "ageGroupLabel,rank,teamName,teamCode",
      '"12 & Under",3,"HPSTL 12 Royal (GW) (4)",g12hpstl1gw',
    ].join("\n");

    const result = parseAesCsv(csv);
    expect(result.fileError).toBeNull();
    expect(result.rows).toEqual([
      {
        rowNumber: 1,
        ageGroupLabel: "12 & Under",
        rank: "3",
        teamNameField: "HPSTL 12 Royal (GW) (4)",
        teamCode: "g12hpstl1gw",
      },
    ]);
  });

  it("handles a quoted team name field containing a comma", () => {
    const csv = [
      "ageGroupLabel,rank,teamName,teamCode",
      '"14 American",1,"Smith, Jones VBC (NT) (1)",g14smith1nt',
    ].join("\n");

    const result = parseAesCsv(csv);
    expect(result.fileError).toBeNull();
    expect(result.rows[0].teamNameField).toBe("Smith, Jones VBC (NT) (1)");
  });

  it("falls back to positional parsing when there's no recognizable header", () => {
    const csv = ['"12 & Under",3,"HPSTL 12 Royal (GW) (4)",g12hpstl1gw'].join("\n");

    const result = parseAesCsv(csv);
    expect(result.fileError).toBeNull();
    expect(result.rows).toEqual([
      {
        rowNumber: 1,
        ageGroupLabel: "12 & Under",
        rank: "3",
        teamNameField: "HPSTL 12 Royal (GW) (4)",
        teamCode: "g12hpstl1gw",
      },
    ]);
  });

  it("reports a file error for an empty file", () => {
    const result = parseAesCsv("   ");
    expect(result.fileError).not.toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("reports a file error when positional rows don't have 4 columns", () => {
    const csv = ["a,b,c"].join("\n");
    const result = parseAesCsv(csv);
    expect(result.fileError).not.toBeNull();
  });

  it("assigns sequential 1-based row numbers across multiple rows", () => {
    const csv = [
      "ageGroupLabel,rank,teamName,teamCode",
      '"14 Open",1,"Team A (NT) (1)",g14teama1nt',
      '"14 Open",2,"Team B (NT) (2)",g14teamb1nt',
    ].join("\n");

    const result = parseAesCsv(csv);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
  });
});
