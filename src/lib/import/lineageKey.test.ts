import { describe, expect, it } from "vitest";
import { computeLineageKey } from "./lineageKey";

describe("computeLineageKey", () => {
  it("joins club code, region, and team number", () => {
    expect(computeLineageKey("skyln", "nt", "1")).toBe("skyln:nt:1");
  });

  it("normalizes casing so the same team matches across seasons", () => {
    expect(computeLineageKey("SKYLN", "NT", "A")).toBe("skyln:nt:a");
  });
});
