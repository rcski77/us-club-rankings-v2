import { runInWorker } from "./runInWorker";

/**
 * Runs resolveImportBatch in a separate process instead of inline in the server
 * action (see runInWorker.ts for why execFile, not worker_threads/fork). A Resolve
 * pass loads and JS-maps every Club/Team/Division/TeamFinish row this batch
 * references and then runs a synchronous per-row pass over the whole batch (see
 * resolve.ts) -- CPU-bound work that, run inline, pins the same process Next uses
 * to serve every other request for the whole duration.
 *
 * This is deliberately the lightest option, not a real job queue -- see
 * docs/plan.md's Resolve-performance note for when a queue + separate worker
 * container would be worth the added complexity.
 */
export function resolveImportBatchInWorker(batchId: string): Promise<void> {
  return runInWorker<{ batchId: string }, void>("lib/import/resolveWorkerEntry.ts", { batchId });
}
