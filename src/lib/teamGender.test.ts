import { describe, expect, it } from "vitest";
import {
  divisionGendersInPartition,
  parseRankingGender,
  partitionGenderForDivision,
  rankingGenderParam,
} from "./teamGender";

describe("partitionGenderForDivision", () => {
  it("maps boys divisions to the boys bucket", () => {
    expect(partitionGenderForDivision("BOYS")).toBe("BOYS");
  });

  it("maps girls and coed divisions to the girls bucket", () => {
    expect(partitionGenderForDivision("GIRLS")).toBe("GIRLS");
    expect(partitionGenderForDivision("COED")).toBe("GIRLS");
  });
});

describe("divisionGendersInPartition", () => {
  it("is the inverse of partitionGenderForDivision", () => {
    for (const g of ["GIRLS", "BOYS", "COED"] as const) {
      expect(divisionGendersInPartition(partitionGenderForDivision(g))).toContain(g);
    }
    expect(divisionGendersInPartition("BOYS")).toEqual(["BOYS"]);
  });
});

describe("parseRankingGender", () => {
  it("reads boys case-insensitively and defaults everything else to girls", () => {
    expect(parseRankingGender("boys")).toBe("BOYS");
    expect(parseRankingGender("BOYS")).toBe("BOYS");
    expect(parseRankingGender("girls")).toBe("GIRLS");
    expect(parseRankingGender(undefined)).toBe("GIRLS");
    expect(parseRankingGender("coed")).toBe("GIRLS");
    expect(parseRankingGender(["boys", "girls"])).toBe("BOYS");
  });

  it("round-trips through rankingGenderParam", () => {
    expect(parseRankingGender(rankingGenderParam("BOYS"))).toBe("BOYS");
    expect(parseRankingGender(rankingGenderParam("GIRLS"))).toBe("GIRLS");
  });
});
