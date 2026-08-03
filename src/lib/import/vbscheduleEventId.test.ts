import { describe, expect, it } from "vitest";
import { parseVbscheduleEventIdFromUrl } from "./vbscheduleEventId";

describe("parseVbscheduleEventIdFromUrl", () => {
  it("extracts the id from an event URL", () => {
    expect(parseVbscheduleEventIdFromUrl("https://vbschedule.com/events/230")).toBe("230");
  });

  it("extracts the id when the URL has a trailing path segment", () => {
    expect(parseVbscheduleEventIdFromUrl("https://vbschedule.com/events/230/division/1123")).toBe("230");
  });

  it("extracts the id when the URL has a trailing slash", () => {
    expect(parseVbscheduleEventIdFromUrl("https://vbschedule.com/events/230/")).toBe("230");
  });

  it("accepts a bare id with no URL wrapper", () => {
    expect(parseVbscheduleEventIdFromUrl("230")).toBe("230");
  });

  it("trims surrounding whitespace", () => {
    expect(parseVbscheduleEventIdFromUrl("  230  ")).toBe("230");
  });

  it("returns null for an empty string", () => {
    expect(parseVbscheduleEventIdFromUrl("")).toBeNull();
  });

  it("returns null for a URL with no event id and no bare-id shape", () => {
    expect(parseVbscheduleEventIdFromUrl("https://vbschedule.com/")).toBeNull();
  });
});
