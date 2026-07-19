import { describe, expect, it } from "vitest";
import { decodeAesTeamCode, isAesTeamCodeParseError } from "./aesTeamCode";

describe("decodeAesTeamCode", () => {
  it("decodes a well-formed code", () => {
    const result = decodeAesTeamCode("g14skyln1nt");
    expect(isAesTeamCodeParseError(result)).toBe(false);
    expect(result).toEqual({
      gender: "g",
      ageGroup: 14,
      clubExternalCode: "skyln",
      teamNumber: "1",
      regionCode: "nt",
    });
  });

  it("lowercases club and region codes", () => {
    const result = decodeAesTeamCode("G14SKYLN1NT");
    expect(isAesTeamCodeParseError(result)).toBe(false);
    if (!isAesTeamCodeParseError(result)) {
      expect(result.clubExternalCode).toBe("skyln");
      expect(result.regionCode).toBe("nt");
    }
  });

  it("errors on the wrong length", () => {
    const result = decodeAesTeamCode("g14skyln1n");
    expect(isAesTeamCodeParseError(result)).toBe(true);
  });

  it("errors on a non-numeric age group segment", () => {
    const result = decodeAesTeamCode("gxxskyln1nt");
    expect(isAesTeamCodeParseError(result)).toBe(true);
  });

  // Confirmed against a real 2026 USAV Girls Junior National Championship sample:
  // team designators aren't always numeric -- at least one real team used a lettered
  // designator instead of a digit (e.g. "g14nwrvbace" -- team "a").
  it("decodes a lettered team designator", () => {
    const result = decodeAesTeamCode("g14skylnxnt");
    expect(isAesTeamCodeParseError(result)).toBe(false);
    if (!isAesTeamCodeParseError(result)) {
      expect(result.teamNumber).toBe("x");
    }
  });

  it("errors on a non-alphanumeric team number segment", () => {
    const result = decodeAesTeamCode("g14skyln-nt");
    expect(isAesTeamCodeParseError(result)).toBe(true);
  });

  it("does not range-check gender -- passes odd-but-structurally-valid values through", () => {
    const result = decodeAesTeamCode("x14skyln1nt");
    expect(isAesTeamCodeParseError(result)).toBe(false);
    if (!isAesTeamCodeParseError(result)) {
      expect(result.gender).toBe("x");
    }
  });

  // Confirmed against a real 2026 USAV Girls Junior National Championship sample:
  // team numbers aren't fixed-width -- a club fielding 10+ teams under one shared
  // code (e.g. the multi-region "A5" chain) needs 2+ digits.
  it("decodes a two-digit team number", () => {
    const result = decodeAesTeamCode("g14afive23so");
    expect(isAesTeamCodeParseError(result)).toBe(false);
    expect(result).toEqual({
      gender: "g",
      ageGroup: 14,
      clubExternalCode: "afive",
      teamNumber: "23",
      regionCode: "so",
    });
  });

  it("decodes a lettered team designator even when the code is longer than 11 chars", () => {
    const result = decodeAesTeamCode("g14nwrvbace");
    expect(isAesTeamCodeParseError(result)).toBe(false);
    expect(result).toEqual({
      gender: "g",
      ageGroup: 14,
      clubExternalCode: "nwrvb",
      teamNumber: "a",
      regionCode: "ce",
    });
  });
});
