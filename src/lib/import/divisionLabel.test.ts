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
      expect(result.tierLabel).toBe("PREMIER");
      expect(result.tierLevel).toBe("II");
    }
  });

  it("merges USAV's National into the same PREMIER tier as AAU's Premier", () => {
    const national = parseAgeGroupLabel("14 National");
    const premier = parseAgeGroupLabel("14 Premier");
    expect(isDivisionLabelParseError(national)).toBe(false);
    expect(isDivisionLabelParseError(premier)).toBe(false);
    if (!isDivisionLabelParseError(national) && !isDivisionLabelParseError(premier)) {
      expect(national.tierLabel).toBe("PREMIER");
      expect(premier.tierLabel).toBe("PREMIER");
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
    const result = parseAgeGroupLabel("12/13 Elite");
    expect(isDivisionLabelParseError(result)).toBe(false);
    if (!isDivisionLabelParseError(result)) {
      expect(result.ageGroup).toBe(13);
      // "Elite" isn't a recognized tier keyword -- still defaults to OPEN and flags it.
      expect(result.tierLabel).toBe("OPEN");
      expect(result.tierWasDefaulted).toBe(true);
    }
  });

  it("recognizes AAU tier keywords, including in a combined age-range label", () => {
    const result = parseAgeGroupLabel("12/13 Club");
    expect(isDivisionLabelParseError(result)).toBe(false);
    if (!isDivisionLabelParseError(result)) {
      expect(result.ageGroup).toBe(13);
      expect(result.tierLabel).toBe("CLUB");
      expect(result.tierWasDefaulted).toBe(false);
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
    for (const tier of [
      "Open",
      "American",
      "Patriot",
      "Liberty",
      "USA",
      "Freedom",
      "Premier",
      "Club",
      "Classic",
    ]) {
      const result = parseAgeGroupLabel(`16 ${tier}`);
      expect(isDivisionLabelParseError(result)).toBe(false);
      if (!isDivisionLabelParseError(result)) {
        expect(result.tierLabel).toBe(tier.toUpperCase());
      }
    }
  });
});
