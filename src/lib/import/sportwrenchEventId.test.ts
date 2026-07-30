import { describe, expect, it } from "vitest";
import { parseSportwrenchEventIdFromUrl } from "./sportwrenchEventId";

describe("parseSportwrenchEventIdFromUrl", () => {
  it("extracts the id from a hash-routed event URL", () => {
    expect(parseSportwrenchEventIdFromUrl("https://events.sportwrench.com/#/events/c098ff439")).toBe(
      "c098ff439",
    );
  });

  it("extracts the id from a non-hash event URL with a trailing path segment", () => {
    expect(
      parseSportwrenchEventIdFromUrl("https://events2.sportwrench.com/events/c098ff439/divisions"),
    ).toBe("c098ff439");
  });

  it("extracts the id when the URL has a trailing slash", () => {
    expect(parseSportwrenchEventIdFromUrl("https://events.sportwrench.com/#/events/c098ff439/")).toBe(
      "c098ff439",
    );
  });

  it("extracts the id when the URL has a query string", () => {
    expect(
      parseSportwrenchEventIdFromUrl("https://events.sportwrench.com/#/events/c098ff439?tab=standings"),
    ).toBe("c098ff439");
  });

  it("accepts a bare id with no URL wrapper", () => {
    expect(parseSportwrenchEventIdFromUrl("c098ff439")).toBe("c098ff439");
  });

  it("trims surrounding whitespace", () => {
    expect(parseSportwrenchEventIdFromUrl("  c098ff439  ")).toBe("c098ff439");
  });

  it("returns null for an empty string", () => {
    expect(parseSportwrenchEventIdFromUrl("")).toBeNull();
  });

  it("returns null for a URL with no event id and no bare-id shape", () => {
    expect(parseSportwrenchEventIdFromUrl("https://events.sportwrench.com/")).toBeNull();
  });
});
