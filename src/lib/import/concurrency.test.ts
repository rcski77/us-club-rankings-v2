import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const delays = [30, 10, 20, 0, 15];
    const result = await mapWithConcurrency(delays, 3, (ms, i) => {
      return new Promise<number>((resolve) => setTimeout(() => resolve(i), ms));
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs more than the given concurrency at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 4, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("handles an empty input", async () => {
    const result = await mapWithConcurrency([] as number[], 5, async (n) => n);
    expect(result).toEqual([]);
  });

  it("handles concurrency higher than the item count", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 10, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it("propagates a rejection from any item", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
