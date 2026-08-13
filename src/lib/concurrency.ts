// Bounded-concurrency map -- used by the Colley/Elo/Massey season-recompute loops
// (see each computeXRatingsForSeason) to process multiple (season, ageGroup)
// partitions at once instead of fully sequentially, without opening more DB
// connections/transactions at once than the pool can comfortably hold.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// @prisma/adapter-pg's underlying node-postgres Pool defaults to 10 connections (no
// override in src/lib/prisma.ts) -- capped below that default so a season-recompute's
// partitions can't alone exhaust the pool, leaving headroom for whatever else is
// sharing it (nightlyRecompute.ts runs in-process on the main app's pool, unlike the
// manually-triggered recompute's own spawned worker process -- see
// recomputeRatingsWorkerEntry.ts).
export const PARTITION_RECOMPUTE_CONCURRENCY = 4;

// Prisma's $transaction `maxWait` (time allowed to acquire a connection before the
// transaction even starts) defaults to 2000ms -- fine for a single caller, but too
// tight once PARTITION_RECOMPUTE_CONCURRENCY partitions all try to open a transaction
// around the same moment (confirmed locally: "Unable to start a transaction in the
// given time" even with a generously-sized pool -- see src/lib/prisma.ts -- so this is
// specifically the wait-for-a-connection timeout, not the pool being too small).
// Passed explicitly to every $transaction call inside a parallelized partition loop.
export const PARTITION_TRANSACTION_MAX_WAIT = 30_000;
