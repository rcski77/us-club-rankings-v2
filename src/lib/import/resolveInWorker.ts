import { runInWorker } from "./runInWorker";

/**
 * Runs resolveImportBatch on a worker thread instead of inline in the server action.
 * A Resolve pass loads and JS-maps every Club/Team/Division/TeamFinish row this batch
 * references and then runs a synchronous per-row pass over the whole batch (see
 * resolve.ts) -- CPU-bound work that, run inline, pins the same single thread Next
 * uses to serve every other request for the whole duration. A worker thread gets its
 * own V8 isolate/thread, so this keeps the main event loop free to keep serving other
 * admin requests while a Resolve is in flight.
 *
 * This is intentionally the lightest option, not full process isolation -- see
 * docs/plan.md's Resolve-performance note for the heavier alternatives
 * (child_process.fork for real OS-process isolation, or a job queue + separate
 * worker container for true async/queued UI) and when they'd be worth the added
 * complexity.
 */
export function resolveImportBatchInWorker(batchId: string): Promise<void> {
  return runInWorker<{ batchId: string }, void>("resolveWorkerEntry.ts", { batchId });
}
