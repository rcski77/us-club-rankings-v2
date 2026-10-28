import { describe, expect, it } from "vitest";
import { divisionGenderCounts, divisionLabelKey, majorityDivisionGender } from "./divisionGender";

describe("majorityDivisionGender", () => {
  it("picks the majority of the team-code genders", () => {
    expect(majorityDivisionGender(["BOYS", "BOYS", "GIRLS"])).toBe("BOYS");
    expect(majorityDivisionGender(["GIRLS", "GIRLS", "BOYS"])).toBe("GIRLS");
    expect(majorityDivisionGender(["BOYS"])).toBe("BOYS");
  });

  it("defaults a tie to girls", () => {
    expect(majorityDivisionGender(["BOYS", "GIRLS"])).toBe("GIRLS");
  });

  it("ignores unrecognized codes and defaults to girls when none are recognized", () => {
    expect(majorityDivisionGender([null, null, "BOYS"])).toBe("BOYS");
    expect(majorityDivisionGender([null, undefined])).toBe("GIRLS");
    expect(majorityDivisionGender([])).toBe("GIRLS");
  });
});

describe("divisionGenderCounts", () => {
  it("counts each gender, skipping unrecognized codes", () => {
    expect(divisionGenderCounts(["BOYS", "GIRLS", "BOYS", null])).toEqual({ girls: 1, boys: 2 });
  });
});

describe("divisionLabelKey", () => {
  it("groups labels case- and whitespace-insensitively", () => {
    expect(divisionLabelKey("  15 Open ")).toBe(divisionLabelKey("15 open"));
  });
});
