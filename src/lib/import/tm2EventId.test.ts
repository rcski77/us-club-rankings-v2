import { describe, expect, it } from "vitest";
import { parseTm2EventIdFromUrl } from "./tm2EventId";

describe("parseTm2EventIdFromUrl", () => {
  it("extracts the id from an app event URL", () => {
    expect(parseTm2EventIdFromUrl("https://tm2sign.com/app/event/2169")).toBe("2169");
  });

  it("extracts the id when the URL has a trailing path segment", () => {
    expect(parseTm2EventIdFromUrl("https://tm2sign.com/app/event/2169/division/10538")).toBe("2169");
  });

  it("extracts the id when the URL has a trailing slash", () => {
    expect(parseTm2EventIdFromUrl("https://tm2sign.com/app/event/2169/")).toBe("2169");
  });

  it("accepts a bare id with no URL wrapper", () => {
    expect(parseTm2EventIdFromUrl("2169")).toBe("2169");
  });

  it("trims surrounding whitespace", () => {
    expect(parseTm2EventIdFromUrl("  2169  ")).toBe("2169");
  });

  it("returns null for an empty string", () => {
    expect(parseTm2EventIdFromUrl("")).toBeNull();
  });

  it("returns null for a URL with no event id and no bare-id shape", () => {
    expect(parseTm2EventIdFromUrl("https://tm2sign.com/")).toBeNull();
  });
});
