import { describe, expect, it } from "vitest";
import { suggestClubName } from "./clubNameSuggestion";

describe("suggestClubName", () => {
  it("strips a bare age-group token", () => {
    expect(suggestClubName("Paramount VBC 14 Jaz")).toBe("Paramount VBC");
    expect(suggestClubName("Circle City 14 Black")).toBe("Circle City");
    expect(suggestClubName("Dal Skyline 14 White-Iv")).toBe("Dal Skyline");
  });

  it("strips a gender/under-prefixed age token", () => {
    expect(suggestClubName("EU U14-Black")).toBe("EU");
    expect(suggestClubName("Ultimate G14 Gold")).toBe("Ultimate");
  });

  it("stops at an apostrophe-suffixed age token", () => {
    // Real example: this club's actual name is confirmed "MADFROG" elsewhere in
    // the seeded demo data, validating the heuristic against ground truth.
    expect(suggestClubName("MADFROG 14'S N BLACK")).toBe("MADFROG");
  });

  it("does not false-positive on an unrelated number", () => {
    expect(suggestClubName("915 14 Hill")).toBe("915");
  });

  it("falls back to the full name when no age token is found", () => {
    expect(suggestClubName("Some Club Name")).toBe("Some Club Name");
  });

  it("falls back to the full name rather than truncate mid-token", () => {
    // "14N" has no trailing word boundary after the digits, so it's not treated
    // as an age token -- under-trimming is the safe failure mode here.
    expect(suggestClubName("1United 14N Blue")).toBe("1United 14N Blue");
  });
});
