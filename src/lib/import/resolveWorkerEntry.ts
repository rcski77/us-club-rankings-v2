import { resolveImportBatch } from "./resolve";

// Entry point run in the child process spawned by resolveImportBatchInWorker (see
// runInWorker.ts for why it's a separate execFile'd process rather than a worker
// thread or a forked process). Importing "./resolve" here -- rather than passing a
// Prisma client across the process boundary, which isn't possible -- pulls in
// "@/lib/prisma" fresh in this process's own module registry, so this process gets
// its own independent PrismaClient/pg connection pool, separate from the parent's.
async function main(): Promise<void> {
  const { batchId } = JSON.parse(process.argv[2]) as { batchId: string };
  await resolveImportBatch(batchId);
}

// execFile (the parent side, runInWorker.ts) waits for this process to exit
// naturally -- there's no equivalent of worker.terminate()/child.kill() to force
// it from the outside. An open pg Pool (via the PrismaClient this process created)
// keeps the event loop alive indefinitely otherwise, so exit explicitly once the
// result is printed.
main()
  .then(() => {
    console.log(JSON.stringify({ ok: true, data: undefined }));
    process.exit(0);
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(0);
  });
