import { parentPort, workerData } from "node:worker_threads";
import { resolveImportBatch } from "./resolve";

// Entry point run inside the worker thread spawned by resolveImportBatchInWorker
// (see that file for why). Importing "./resolve" here -- rather than passing a
// Prisma client across the thread boundary, which isn't possible -- pulls in
// "@/lib/prisma" fresh in this thread's own module registry, so this worker gets
// its own independent PrismaClient/pg connection pool, separate from the main
// thread's.
async function main() {
  const { batchId } = workerData as { batchId: string };
  await resolveImportBatch(batchId);
}

main()
  .then(() => parentPort?.postMessage({ ok: true as const, data: undefined }))
  .catch((err) => {
    parentPort?.postMessage({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    });
  });
