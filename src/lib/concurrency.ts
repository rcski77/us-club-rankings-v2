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

// Started at 4, which was fine against local dev's much smaller dataset but
// destabilized prod on the homelab host: 4 partitions computing/writing at once
// against the real season's data (tens of thousands of matches in the largest age
// groups) overloaded the host enough that Postgres itself started timing out new
// connection auth and dropping existing ones ("canceling authentication due to
// timeout", "Connection reset by peer") -- a host resource-contention problem
// (CPU/memory on a shared homelab box), not a connection-pool-size problem (Postgres's
// own max_connections was nowhere close to hit). Dropped to 2 as a more conservative
// middle ground between "no parallelism" and the host-overloading 4. If this still
// causes instability under prod's real data volume, drop to 1 (fully sequential --
// the fetch-dedup and split-transaction wins still apply independent of this) rather
// than raising it further.
export const PARTITION_RECOMPUTE_CONCURRENCY = 2;

// Prisma's $transaction `maxWait` (time allowed to acquire a connection before the
// transaction even starts) defaults to 2000ms -- fine for a single caller, but too
// tight once PARTITION_RECOMPUTE_CONCURRENCY partitions all try to open a transaction
// around the same moment (confirmed locally: "Unable to start a transaction in the
// given time" even with a generously-sized pool -- see src/lib/prisma.ts -- so this is
// specifically the wait-for-a-connection timeout, not the pool being too small).
// Passed explicitly to every $transaction call inside a parallelized partition loop.
export const PARTITION_TRANSACTION_MAX_WAIT = 30_000;
