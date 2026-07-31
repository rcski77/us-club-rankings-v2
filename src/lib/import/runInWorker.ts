import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkerOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

function workerEntryPath(entryRelativePath: string): string {
  return `${process.cwd()}/src/${entryRelativePath}`;
}

/**
 * Runs a *WorkerEntry.ts file (path given relative to src/, e.g.
 * "lib/import/resolveWorkerEntry.ts") in a separate OS process (via
 * `child_process.execFile`), resolving with whatever result it prints to stdout as
 * its last line. Shared by resolveInWorker.ts, commitMatchesInWorker.ts, and
 * recomputeRatingsInWorker.ts -- all move heavy work off the process Next uses to
 * serve every other admin request, for their own different reasons (see each call
 * site).
 *
 * This went through two other approaches first, both of which Turbopack broke in
 * ways that only showed up in a real Docker build, not `next dev`:
 *
 * 1. `node:worker_threads`' `new Worker(...)`. Next's own docs confirm Turbopack
 *    intercepts `new Worker(...)` expressions to bundle/resolve the target at build
 *    time. The build itself succeeded, but the *runtime* moduleContext lookup it
 *    generates was unreliable -- it worked in some Docker builds and threw
 *    `Cannot find module '.../resolveWorkerEntry.ts'` in others, for byte-identical
 *    code. Neither the documented `/* turbopackIgnore: true *\/` escape hatch nor
 *    obscuring the `Worker` identifier (fetching the constructor off the
 *    `node:worker_threads` namespace object via a computed property, so there's no
 *    literal `new Worker(` text) fixed it reliably.
 * 2. `child_process.fork(...)`. Not in Turbopack's documented list of intercepted
 *    expressions, but it turned out to be intercepted anyway -- and more
 *    aggressively: the build itself failed outright ("Module not found: Can't
 *    resolve './ROOT/src/lib/import'"), regardless of how opaque the path argument
 *    was made (`path.join`, plain string concatenation, even base64-decoding the
 *    directory segment so there was no path-shaped string literal anywhere in the
 *    file). Turbopack appears to intercept *any* non-literal first argument to
 *    `fork(...)`, not the string's content.
 *
 * `execFile` doesn't share a module-loading shape with any of Turbopack's
 * documented or observed intercepted expressions -- it runs an executable
 * (`process.execPath`, i.e. `node`) with argv, which is conceptually "run a
 * program," not "load a module." Confirmed stable across a `--no-cache` Docker
 * rebuild, verified against the real bundled server action (not just a standalone
 * script) -- see docs/plan.md's "Resolve performance" note for the full history.
 *
 * No IPC channel here (execFile doesn't give you one the way fork does), so the
 * payload goes in as a JSON argv string and the result comes back as the last line
 * the child process prints to stdout -- see resolveWorkerEntry.ts /
 * commitMatchesWorkerEntry.ts / recomputeRatingsWorkerEntry.ts for the other side
 * of that contract.
 */
export async function runInWorker<TWorkerData extends Record<string, unknown>, TResult>(
  entryRelativePath: string,
  workerData: TWorkerData,
): Promise<TResult> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", workerEntryPath(entryRelativePath), JSON.stringify(workerData)],
      { maxBuffer: 50 * 1024 * 1024 },
    ));
  } catch (err) {
    // A non-zero exit (e.g. an exception before the entry file's own try/catch
    // could run, or tsx itself failing to load) rejects instead of resolving --
    // surface stderr, since that's where the actual stack trace lands.
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    throw new Error(
      `Worker process (${entryRelativePath}) failed to run: ${err instanceof Error ? err.message : String(err)}${stderr ? `\n${stderr}` : ""}`,
    );
  }

  const lastLine = stdout.trim().split("\n").pop() ?? "";
  let result: WorkerOutcome<TResult>;
  try {
    result = JSON.parse(lastLine);
  } catch {
    throw new Error(`Worker process (${entryRelativePath}) produced unparseable output: ${stdout.slice(-2000)}`);
  }

  if (result.ok) return result.data;
  throw new Error(result.error);
}
