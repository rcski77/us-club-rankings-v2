import { computeColleyRatingsForSeason } from "./computeColleyRatings";
import { computeEloRatingsForSeason } from "./computeEloRatings";
import { computeMasseyRatingsForSeason } from "./computeMasseyRatings";

// Entry point run in the child process spawned by recomputeRatingsInWorker (see
// runInWorker.ts for why it's a separate execFile'd process). Importing these
// compute functions directly here -- rather than passing a Prisma client across the
// process boundary, which isn't possible -- pulls in "@/lib/prisma" fresh in this
// process's own module registry, so this process gets its own independent
// PrismaClient/pg connection pool, separate from the parent's.
async function main(): Promise<void> {
  const { seasonId } = JSON.parse(process.argv[2]) as { seasonId: string };
  // Sequential, not Promise.all -- matches this project's convention of not running
  // concurrent Prisma queries from the same pool (see docs/dev-environment.md), and
  // each engine's per-age-group loop is already the expensive part.
  await computeColleyRatingsForSeason(seasonId);
  await computeEloRatingsForSeason(seasonId);
  await computeMasseyRatingsForSeason(seasonId);
}

// See resolveWorkerEntry.ts's comment on why this process must exit explicitly.
main()
  .then(() => {
    console.log(JSON.stringify({ ok: true, data: undefined }));
    process.exit(0);
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(0);
  });
