import { computeColleyRatingsForSeason } from "./computeColleyRatings";
import { computeEloRatingsForSeason, type PartitionMatchesCache } from "./computeEloRatings";
import { computeMasseyRatingsForSeason } from "./computeMasseyRatings";

// Entry point run in the child process spawned by recomputeRatingsInWorker (see
// runInWorker.ts for why it's a separate execFile'd process). Importing these
// compute functions directly here -- rather than passing a Prisma client across the
// process boundary, which isn't possible -- pulls in "@/lib/prisma" fresh in this
// process's own module registry, so this process gets its own independent
// PrismaClient/pg connection pool, separate from the parent's.
async function main(): Promise<void> {
  const { seasonId } = JSON.parse(process.argv[2]) as { seasonId: string };
  // Colley -> Elo -> Massey stays sequential (each one's internal per-age-group loop
  // is now itself concurrent -- see computeEloRatingsForSeason's own comment -- so
  // there's no benefit to overlapping the three engines too, only more simultaneous
  // DB connections for no reason). asOfDate/weekEndingDate are shared across all
  // three so they rate "as of" the exact same instant, and the shared cache lets Elo
  // and Massey's identical getPartitionMatches fetches happen only once per partition.
  const asOfDate = new Date();
  const weekEndingDate = new Date();
  const partitionMatchesCache: PartitionMatchesCache = new Map();
  await computeColleyRatingsForSeason(seasonId, asOfDate, weekEndingDate);
  await computeEloRatingsForSeason(seasonId, asOfDate, weekEndingDate, partitionMatchesCache);
  await computeMasseyRatingsForSeason(seasonId, asOfDate, weekEndingDate, partitionMatchesCache);
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
