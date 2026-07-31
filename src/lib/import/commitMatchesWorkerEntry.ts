import { importAesMatchResults, importSportwrenchMatchResults } from "./commitMatches";
import type { ImportMatchResultsResult } from "./commitMatches";

type CommitMatchesWorkerData =
  | { source: "AES"; batchId: string; externalEventId: string }
  | { source: "SPORTWRENCH"; batchId: string; externalEventId: string };

// See resolveWorkerEntry.ts's comment on why this file imports "./commitMatches"
// directly rather than receiving a Prisma client from the parent process -- this
// process ends up with its own independent PrismaClient/pg pool.
async function main(): Promise<ImportMatchResultsResult> {
  const data = JSON.parse(process.argv[2]) as CommitMatchesWorkerData;
  if (data.source === "AES") return importAesMatchResults(data.batchId, data.externalEventId);
  return importSportwrenchMatchResults(data.batchId, data.externalEventId);
}

// See resolveWorkerEntry.ts's comment on why this process must exit explicitly.
main()
  .then((data) => {
    console.log(JSON.stringify({ ok: true, data }));
    process.exit(0);
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(0);
  });
