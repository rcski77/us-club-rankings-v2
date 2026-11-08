import type { SeedingTeam } from "./types";

// Pure, client-safe seeding helpers: ordering, near-tie clusters, pool-band boundaries.

export type SeedSort = "avgRank" | "nps";

/** Teams with no value for the chosen sort go last, keeping file order among themselves. */
export function sortForSeeding(teams: SeedingTeam[], sort: SeedSort): SeedingTeam[] {
  const key = (t: SeedingTeam): number | null => (sort === "avgRank" ? t.avgRank : t.npsRank);
  return [...teams].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return a.rowNumber - b.rowNumber;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka - kb || a.rowNumber - b.rowNumber;
  });
}

/**
 * Near-tie clusters over an already-sorted list: consecutive teams whose average rank
 * differs by no more than `gap` chain into one cluster. Only clusters of 2+ are
 * returned, as inclusive index ranges [start, end] into `sorted`. Uses avgRank
 * regardless of the display sort (NPS-only ordering has no comparable gap).
 */
export function findNearTieClusters(sorted: SeedingTeam[], gap = 5): [number, number][] {
  const clusters: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i].avgRank;
    const prev = i > 0 ? sorted[i - 1].avgRank : null;
    const close = cur !== null && prev !== null && Math.abs(cur - prev) <= gap;
    if (close) {
      if (start === -1) start = i - 1;
    } else if (start !== -1) {
      clusters.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) clusters.push([start, sorted.length - 1]);
  return clusters;
}

/** Indexes (into the sorted list) that sit in any near-tie cluster. */
export function nearTieIndexes(clusters: [number, number][]): Set<number> {
  const out = new Set<number>();
  for (const [s, e] of clusters) for (let i = s; i <= e; i++) out.add(i);
  return out;
}

export type BandBoundary = {
  /** Band boundary after this 1-based seed (e.g. 12 means seeds 1-12 | 13+). */
  afterSeed: number;
  /** Teams within `window` seeds either side of the boundary, as sorted indexes. */
  nearIndexes: number[];
  /** True if the teams straddling the boundary fall in the same near-tie cluster. */
  uncertain: boolean;
};

/**
 * Splits `count` teams into `bands` contiguous, near-equal bands (earlier bands take the
 * remainder) and reports the boundary seeds with the teams around each.
 */
export function bandBoundaries(
  count: number,
  bands: number,
  clusters: [number, number][],
  window = 2,
): BandBoundary[] {
  if (bands < 2 || count < 2) return [];
  const base = Math.floor(count / bands);
  const extra = count % bands;
  const out: BandBoundary[] = [];
  let seed = 0;
  for (let b = 0; b < bands - 1; b++) {
    seed += base + (b < extra ? 1 : 0);
    if (seed <= 0 || seed >= count) continue;
    const lo = Math.max(0, seed - window);
    const hi = Math.min(count - 1, seed - 1 + window);
    const nearIndexes: number[] = [];
    for (let i = lo; i <= hi; i++) nearIndexes.push(i);
    const uncertain = clusters.some(([s, e]) => s <= seed - 1 && e >= seed);
    out.push({ afterSeed: seed, nearIndexes, uncertain });
  }
  return out;
}
