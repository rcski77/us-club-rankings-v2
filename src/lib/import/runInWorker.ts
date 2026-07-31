import { Worker } from "node:worker_threads";
import path from "node:path";

export type WorkerOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

// Deliberately NOT `new URL("./foo", import.meta.url)` -- that's the idiomatic
// bundler-aware pattern, but Turbopack (both dev and this project's standalone
// build) doesn't resolve/bundle `new Worker(...)` targets for server code, only
// "Module not found" at compile time. Building the path at runtime from
// process.cwd() instead sidesteps Turbopack's static analysis entirely: the worker
// entry ships as a plain source file, not a bundled asset. process.cwd() is the
// project root in both `next dev` and the Docker runner image (WORKDIR /app, CMD run
// from there) -- see the Dockerfile's runner stage, which COPYs `src/` and
// `tsconfig.json` from the builder stage specifically so this path exists at runtime.
function workerEntryPath(entryFilename: string): string {
  return path.join(process.cwd(), "src/lib/import", entryFilename);
}

/**
 * Runs a src/lib/import/*WorkerEntry.ts file on a worker_threads thread, resolving
 * with whatever result it reports. Shared by resolveInWorker.ts and
 * commitMatchesInWorker.ts -- both move CPU/wall-clock-heavy import work off the
 * thread Next uses to serve every other admin request, for their own different
 * reasons (see each call site).
 *
 * The entry is plain .ts, run directly (not through Next/Turbopack -- see
 * workerEntryPath above) via `tsx`'s loader, registered per-worker through
 * `execArgv` rather than a project-wide `--import` flag so it only applies to this
 * thread. `tsx` is a real (non-dev) dependency for exactly this reason -- it must be
 * present in the deployed image, not just local dev.
 */
export function runInWorker<TWorkerData, TResult>(
  entryFilename: string,
  workerData: TWorkerData,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerEntryPath(entryFilename), {
      execArgv: ["--import", "tsx"],
      workerData,
    });

    let settled = false;

    worker.once("message", (result: WorkerOutcome<TResult>) => {
      settled = true;
      worker.terminate();
      if (result.ok) resolve(result.data);
      else reject(new Error(result.error));
    });

    worker.once("error", (err) => {
      settled = true;
      reject(err);
    });

    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`Worker (${entryFilename}) exited with code ${code} before reporting a result.`));
      }
    });
  });
}
