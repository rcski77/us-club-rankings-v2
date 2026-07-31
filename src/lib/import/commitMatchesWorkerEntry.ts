import { parentPort, workerData } from "node:worker_threads";
import { importAesMatchResults, importSportwrenchMatchResults } from "./commitMatches";
import type { ImportMatchResultsResult } from "./commitMatches";

type CommitMatchesWorkerData =
  | { source: "AES"; batchId: string; externalEventId: string }
  | { source: "SPORTWRENCH"; batchId: string; externalEventId: string };

// See resolveWorkerEntry.ts's comment on why this file imports "./commitMatches"
// directly rather than receiving a Prisma client from the main thread -- this
// worker ends up with its own independent PrismaClient/pg pool.
async function main(): Promise<ImportMatchResultsResult> {
  const data = workerData as CommitMatchesWorkerData;
  if (data.source === "AES") return importAesMatchResults(data.batchId, data.externalEventId);
  return importSportwrenchMatchResults(data.batchId, data.externalEventId);
}

main()
  .then((data) => parentPort?.postMessage({ ok: true as const, data }))
  .catch((err) => {
    parentPort?.postMessage({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    });
  });
