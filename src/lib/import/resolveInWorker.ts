import { Worker } from "node:worker_threads";
import path from "node:path";

type WorkerResult = { ok: true } | { ok: false; error: string };

// Deliberately NOT `new URL("./resolveWorkerEntry", import.meta.url)` -- that's the
// idiomatic bundler-aware pattern, but Turbopack (both dev and this project's
// standalone build) doesn't resolve/bundle `new Worker(...)` targets for server code,
// only "Module not found" at compile time. Building the path at runtime from
// process.cwd() instead sidesteps Turbopack's static analysis entirely: the worker
// entry ships as a plain source file, not a bundled asset. process.cwd() is the
// project root in both `next dev` and the Docker runner image (WORKDIR /app, CMD run
// from there) -- see the Dockerfile's runner stage, which COPYs `src/` and
// `tsconfig.json` from the builder stage specifically so this path exists at runtime.
const WORKER_ENTRY_PATH = path.join(process.cwd(), "src/lib/import/resolveWorkerEntry.ts");

/**
 * Runs resolveImportBatch on a worker thread instead of inline in the server action.
 * A Resolve pass loads and JS-maps every Club/Team/Division/TeamFinish row this batch
 * references and then runs a synchronous per-row pass over the whole batch (see
 * resolve.ts) -- CPU-bound work that, run inline, pins the same single thread Next
 * uses to serve every other request for the whole duration. A worker thread gets its
 * own V8 isolate/thread, so this keeps the main event loop free to keep serving other
 * admin requests while a Resolve is in flight.
 *
 * The worker entry is plain .ts, run directly (not through Next/Turbopack -- see
 * WORKER_ENTRY_PATH above) via `tsx`'s loader, registered per-worker through
 * `execArgv` rather than a project-wide `--import` flag so it only applies to this
 * thread. `tsx` is a real (non-dev) dependency for exactly this reason -- it must be
 * present in the deployed image, not just local dev.
 *
 * This is intentionally the lightest option, not full process isolation -- see
 * docs/plan.md's Resolve-performance note for the heavier alternatives
 * (child_process.fork for real OS-process isolation, or a job queue + separate
 * worker container for true async/queued UI) and when they'd be worth the added
 * complexity.
 */
export function resolveImportBatchInWorker(batchId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_ENTRY_PATH, {
      execArgv: ["--import", "tsx"],
      workerData: { batchId },
    });

    let settled = false;

    worker.once("message", (result: WorkerResult) => {
      settled = true;
      worker.terminate();
      if (result.ok) resolve();
      else reject(new Error(result.error));
    });

    worker.once("error", (err) => {
      settled = true;
      reject(err);
    });

    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`Resolve worker exited with code ${code} before reporting a result.`));
      }
    });
  });
}
