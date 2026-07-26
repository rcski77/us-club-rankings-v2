import { describe, expect, it } from "vitest";
import { parseAesEventIdFromUrl } from "./aesEventId";

describe("parseAesEventIdFromUrl", () => {
  it("extracts the id from a plain event URL", () => {
    expect(parseAesEventIdFromUrl("https://results.advancedeventsystems.com/event/PTAwMDAwMzg4Mzk90")).toBe(
      "PTAwMDAwMzg4Mzk90",
    );
  });

  it("extracts the id when the URL has a trailing slash", () => {
    expect(parseAesEventIdFromUrl("https://results.advancedeventsystems.com/event/PTAwMDAwMzg4Mzk90/")).toBe(
      "PTAwMDAwMzg4Mzk90",
    );
  });

  it("extracts the id when the URL has a trailing path segment", () => {
    expect(
      parseAesEventIdFromUrl("https://results.advancedeventsystems.com/event/PTAwMDAwMzg4Mzk90/schedule"),
    ).toBe("PTAwMDAwMzg4Mzk90");
  });

  it("extracts the id when the URL has a query string", () => {
    expect(
      parseAesEventIdFromUrl("https://results.advancedeventsystems.com/event/PTAwMDAwMzg4Mzk90?tab=standings"),
    ).toBe("PTAwMDAwMzg4Mzk90");
  });

  it("accepts a bare id with no URL wrapper", () => {
    expect(parseAesEventIdFromUrl("PTAwMDAwMzg4Mzk90")).toBe("PTAwMDAwMzg4Mzk90");
  });

  it("trims surrounding whitespace", () => {
    expect(parseAesEventIdFromUrl("  PTAwMDAwMzg4Mzk90  ")).toBe("PTAwMDAwMzg4Mzk90");
  });

  it("returns null for an empty string", () => {
    expect(parseAesEventIdFromUrl("")).toBeNull();
  });

  it("returns null for a URL with no event id and no bare-id shape", () => {
    expect(parseAesEventIdFromUrl("https://results.advancedeventsystems.com/")).toBeNull();
  });
});
