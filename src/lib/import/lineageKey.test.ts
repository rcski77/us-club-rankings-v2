import { describe, expect, it } from "vitest";
import { computeLineageKey } from "./lineageKey";

describe("computeLineageKey", () => {
  it("joins gender, club code, region, and team number", () => {
    expect(computeLineageKey("skyln", "nt", "1", "GIRLS")).toBe("girls:skyln:nt:1");
  });

  it("normalizes casing so the same team matches across seasons", () => {
    expect(computeLineageKey("SKYLN", "NT", "A", "GIRLS")).toBe("girls:skyln:nt:a");
  });

  it("distinguishes boys and girls teams sharing club/region/team number", () => {
    expect(computeLineageKey("skyln", "nt", "1", "GIRLS")).not.toBe(
      computeLineageKey("skyln", "nt", "1", "BOYS"),
    );
  });
});
