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

// Tried 4, then 2 -- both failed against prod's real data volume, for two different
// reasons. At 4: partitions computing/writing at once overloaded the homelab host
// enough that Postgres itself started timing out new connection auth and dropping
// connections ("canceling authentication due to timeout", "Connection reset by peer").
// At 2: a *different* failure -- one partition's synchronous JS compute (the Elo/
// Massey/Colley replay itself, not a DB call) can run long enough to block Node's
// single-threaded event loop, starving a different partition's already-open
// transaction of the chance to send its next query before Postgres's own timeout
// expires ("A query cannot be executed on an expired transaction"). That's not a
// connection-pool or host-resource problem -- it's that "concurrent" async partitions
// still share one JS thread for their CPU-bound compute, so a slow partition can stall
// a different partition's transaction clock even though nothing is actually wrong on
// the DB side. True parallelism here would need separate OS processes/threads, which
// this codebase already ruled out as unreliable with Turbopack (see the long comment
// in runInWorker.ts). Back to 1 -- i.e. no partition parallelism -- until/unless a
// process-based approach is worth the complexity. The fetch-dedup (getPartitionMatches'
// cache) and split-transaction wins from the same change are unaffected by this number
// and still apply.
export const PARTITION_RECOMPUTE_CONCURRENCY = 1;

// Prisma's $transaction `maxWait` (time allowed to acquire a connection before the
// transaction even starts) defaults to 2000ms -- fine for a single caller, but too
// tight once PARTITION_RECOMPUTE_CONCURRENCY partitions all try to open a transaction
// around the same moment (confirmed locally: "Unable to start a transaction in the
// given time" even with a generously-sized pool -- see src/lib/prisma.ts -- so this is
// specifically the wait-for-a-connection timeout, not the pool being too small).
// Passed explicitly to every $transaction call inside a parallelized partition loop.
export const PARTITION_TRANSACTION_MAX_WAIT = 30_000;
