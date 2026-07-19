import { describe, expect, it } from "vitest";
import { parseAesTeamNameField } from "./teamNameField";

describe("parseAesTeamNameField", () => {
  it("strips both trailing parentheticals", () => {
    const result = parseAesTeamNameField("HPSTL 12 Royal (GW) (4)");
    expect(result).toEqual({
      cleanName: "HPSTL 12 Royal",
      regionCodeFromName: "GW",
      tiebreakOrder: 4,
    });
  });

  it("falls back to the trimmed raw string when the shape isn't found", () => {
    const result = parseAesTeamNameField("  MadFrog Green  ");
    expect(result).toEqual({
      cleanName: "MadFrog Green",
      regionCodeFromName: null,
      tiebreakOrder: null,
    });
  });

  it("handles a non-numeric seed value without throwing", () => {
    const result = parseAesTeamNameField("Some Team (NT) (n/a)");
    expect(result.cleanName).toBe("Some Team");
    expect(result.regionCodeFromName).toBe("NT");
    expect(result.tiebreakOrder).toBeNull();
  });

  it("handles only one trailing parenthetical as an unrecognized shape", () => {
    const result = parseAesTeamNameField("Some Team (NT)");
    expect(result.cleanName).toBe("Some Team (NT)");
    expect(result.regionCodeFromName).toBeNull();
  });
});
