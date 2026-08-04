import { describe, expect, it } from "vitest";
import {
  blendPercentileWithElitePresence,
  computeFssPercentile,
  scoreBandForPercentile,
  suggestTemplate,
} from "./suggestPointTemplate";

describe("computeFssPercentile", () => {
  it("returns null for an empty population", () => {
    expect(computeFssPercentile(5, [])).toBeNull();
  });

  it("computes the share of the population at or below the FSS", () => {
    // 3 of 4 values are <= 5
    expect(computeFssPercentile(5, [1, 2, 5, 10])).toBe(75);
  });

  it("returns 100 when the FSS is at or above the whole population", () => {
    expect(computeFssPercentile(10, [1, 2, 3])).toBe(100);
  });
});

describe("scoreBandForPercentile", () => {
  it("bands a top percentile as Elite field", () => {
    expect(scoreBandForPercentile(95)).toBe("Elite field");
  });

  it("bands a low percentile as Developmental", () => {
    expect(scoreBandForPercentile(10)).toBe("Developmental");
  });

  it("bands exactly at a cutoff into the higher band", () => {
    expect(scoreBandForPercentile(70)).toBe("Strong regional");
  });

  it("bands a national-caliber percentile as National, between Strong regional and Elite field", () => {
    expect(scoreBandForPercentile(85)).toBe("National");
    expect(scoreBandForPercentile(80)).toBe("National");
    expect(scoreBandForPercentile(79)).toBe("Strong regional");
    expect(scoreBandForPercentile(90)).toBe("Elite field");
  });
});

describe("blendPercentileWithElitePresence", () => {
  it("falls back to the raw FSS percentile when elitePresence is null", () => {
    expect(blendPercentileWithElitePresence(40, null)).toBe(40);
  });

  it("blends FSS percentile and elite presence at the given weight", () => {
    // default weight 0.5: (40 + 98) / 2 = 69
    expect(blendPercentileWithElitePresence(40, 98)).toBe(69);
  });

  it("lets a high elite presence lift a field-depth-diluted FSS percentile", () => {
    // a large field's FSS percentile alone (40) undersells it once its elite
    // presence (98%) is blended in -- this is the NIT case.
    const blended = blendPercentileWithElitePresence(40, 98);
    expect(blended).toBeGreaterThan(40);
  });

  it("supports a custom blend weight", () => {
    expect(blendPercentileWithElitePresence(40, 100, 0.25)).toBe(55);
  });
});

describe("suggestTemplate", () => {
  const templates = [
    { id: "elite", maxPoints: 245 },
    { id: "strong", maxPoints: 200 },
    { id: "solid", maxPoints: 150 },
    { id: "developmental", maxPoints: 100 },
  ];

  it("returns null when there are no templates", () => {
    expect(suggestTemplate(50, [])).toBeNull();
  });

  it("picks the strongest template at percentile 100", () => {
    expect(suggestTemplate(100, templates)).toBe("elite");
  });

  it("picks the weakest template at percentile 0", () => {
    expect(suggestTemplate(0, templates)).toBe("developmental");
  });

  it("clamps out-of-range percentiles instead of throwing", () => {
    expect(suggestTemplate(150, templates)).toBe("elite");
    expect(suggestTemplate(-10, templates)).toBe("developmental");
  });
});
