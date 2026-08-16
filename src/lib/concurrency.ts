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

// Prisma's $transaction `maxWait` (time allowed to acquire a connection before the
// transaction even starts) defaults to 2000ms -- fine for a single caller, but too
// tight once several partitions all try to open a transaction around the same moment
// (confirmed locally: "Unable to start a transaction in the given time" even with a
// generously-sized pool -- see src/lib/prisma.ts -- so this is specifically the
// wait-for-a-connection timeout, not the pool being too small). Passed explicitly to
// every $transaction call inside a parallelized partition loop.
export const PARTITION_TRANSACTION_MAX_WAIT = 30_000;

// Governs the OS-process fan-out in rankingComputeServer.ts (see that file) -- each
// unit of "concurrency" here is a full `execFile`-spawned child process, not an
// in-process async task.
//
// That distinction matters: this project tried in-process async concurrency for the
// same per-partition work first (a bounded Promise pool over Colley/Elo/Massey's
// per-age-group loops), and it failed against prod's real data volume twice, for two
// different reasons. At 4-way concurrency: partitions computing/writing at once
// overloaded the homelab host enough that Postgres itself started timing out new
// connection auth and dropping connections ("canceling authentication due to
// timeout", "Connection reset by peer"). At 2-way: a *different* failure -- one
// partition's synchronous JS compute (the Elo/Massey/Colley replay itself, not a DB
// call) ran long enough to block Node's single-threaded event loop, starving a
// different partition's already-open transaction of the chance to send its next
// query before Postgres's own timeout expired ("A query cannot be executed on an
// expired transaction"). Neither was a connection-pool or host-resource problem in
// the usual sense -- "concurrent" async partitions still shared one JS thread for
// their CPU-bound compute, so a slow partition could stall a different partition's
// transaction clock even though nothing was actually wrong on the DB side.
//
// Separate OS processes don't have that failure mode: no single JS thread to block,
// and each process's own Prisma pool only holds a connection for as long as its own
// query/transaction needs one. Still starting conservative at 2, not the target 4,
// and raising it only after live verification on prod's real data volume -- the
// homelab host has just 4 vCPUs today (shared with Postgres and the app itself), so
// even process-level parallelism can still starve the host if pushed too far too
// fast. Raise once the VM's vCPU allocation grows and a staged live test at the new
// value passes clean.
export const PARTITION_PROCESS_CONCURRENCY = 2;
