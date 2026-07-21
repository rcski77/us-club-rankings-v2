import { describe, expect, it } from "vitest";
import { isDivisionLabelParseError, parseAgeGroupLabel } from "./divisionLabel";

describe("parseAgeGroupLabel", () => {
  it("parses age + tier", () => {
    const result = parseAgeGroupLabel("14 American");
    expect(isDivisionLabelParseError(result)).toBe(false);
    expect(result).toEqual({
      ageGroup: 14,
      tierLabel: "AMERICAN",
      tierLevel: null,
      tierWasDefaulted: false,
    });
  });

  it("parses tier case-insensitively", () => {
    const result = parseAgeGroupLabel("17 open");
    expect(isDivisionLabelParseError(result)).toBe(false);
    if (!isDivisionLabelParseError(result)) {
      expect(result.tierLabel).toBe("OPEN");
      expect(result.tierWasDefaulted).toBe(false);
    }
  });

  it("parses a tier level roman numeral", () => {
    const result = parseAgeGroupLabel("12 National II");
    expect(isDivisionLabelParseError(result)).toBe(false);
    if (!isDivisionLabelParseError(result)) {
      expect(result.tierLabel).toBe("NATIONAL");
      expect(result.tierLevel).toBe("II");
    }
  });

  it("defaults to OPEN and flags it when no tier keyword is present (anchor-event case)", () => {
    const result = parseAgeGroupLabel("12 & Under");
    expect(isDivisionLabelParseError(result)).toBe(false);
    expect(result).toEqual({
      ageGroup: 12,
      tierLabel: "OPEN",
      tierLevel: null,
      tierWasDefaulted: true,
    });
  });

  it("errors when there is no leading age number", () => {
    const result = parseAgeGroupLabel("Open Division");
    expect(isDivisionLabelParseError(result)).toBe(true);
  });

  it("takes the older age as nominal for a combined age-range label", () => {
    const result = parseAgeGroupLabel("12/13 Club");
    expect(isDivisionLabelParseError(result)).toBe(false);
    if (!isDivisionLabelParseError(result)) {
      expect(result.ageGroup).toBe(13);
      // "Club" isn't a recognized tier keyword -- still defaults to OPEN and flags it.
      expect(result.tierLabel).toBe("OPEN");
      expect(result.tierWasDefaulted).toBe(true);
    }
  });

  it("handles a combined age range with tolerant spacing around the slash", () => {
    const result = parseAgeGroupLabel("17 / 18 Elite");
    expect(isDivisionLabelParseError(result)).toBe(false);
    if (!isDivisionLabelParseError(result)) {
      expect(result.ageGroup).toBe(18);
    }
  });

  it("matches every DivisionTierLabel keyword", () => {
    for (const tier of ["Open", "National", "American", "Patriot", "Liberty", "USA", "Freedom"]) {
      const result = parseAgeGroupLabel(`16 ${tier}`);
      expect(isDivisionLabelParseError(result)).toBe(false);
      if (!isDivisionLabelParseError(result)) {
        expect(result.tierLabel).toBe(tier.toUpperCase());
      }
    }
  });
});
