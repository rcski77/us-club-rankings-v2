import { runInWorker } from "./runInWorker";
import type { ImportMatchResultsResult } from "./commitMatches";

type CommitMatchesWorkerData =
  | { source: "AES"; batchId: string; externalEventId: string }
  | { source: "SPORTWRENCH"; batchId: string; externalEventId: string };

/**
 * Runs importAesMatchResults/importSportwrenchMatchResults on a worker thread.
 * Different motivation than resolveImportBatchInWorker's: the dominant cost here
 * isn't CPU, it's hundreds-to-thousands of sequential/bounded-concurrent external
 * HTTP round-trips (see sportwrenchMatches.ts) that can still run well past a
 * minute for a large event. Running that on a worker thread keeps the main thread
 * free to serve every other admin's requests for the whole duration -- it does NOT
 * make the triggering admin's own request finish any faster (the browser is still
 * waiting on the same fetch+resolve+commit pipeline; see sportwrenchMatches.ts's
 * bounded-concurrency fetch for what actually shortens that). It does mean the
 * import keeps running to completion even if a fronting proxy (e.g. Cloudflare,
 * which times out proxied requests at ~100s on non-Enterprise plans) gives up on
 * the request and shows the admin an error page before the work is actually done --
 * a worker thread's lifecycle isn't tied to the HTTP response the way inline
 * `await`ed work implicitly is.
 */
function importMatchResultsInWorker(data: CommitMatchesWorkerData): Promise<ImportMatchResultsResult> {
  return runInWorker("commitMatchesWorkerEntry.ts", data);
}

export function importAesMatchResultsInWorker(
  batchId: string,
  aesEventId: string,
): Promise<ImportMatchResultsResult> {
  return importMatchResultsInWorker({ source: "AES", batchId, externalEventId: aesEventId });
}

export function importSportwrenchMatchResultsInWorker(
  batchId: string,
  sportwrenchEventId: string,
): Promise<ImportMatchResultsResult> {
  return importMatchResultsInWorker({ source: "SPORTWRENCH", batchId, externalEventId: sportwrenchEventId });
}
