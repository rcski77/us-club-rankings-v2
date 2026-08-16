import { computeEloRatingsForPartition, type PartitionMatchesCache } from "./computeEloRatings";
import { computeMasseyRatingsForPartition } from "./computeMasseyRatings";

// One partition's worth of the Elo+Massey phase, run in its own OS process -- see
// computeColleyPartitionWorkerEntry.ts's own comment for why (process-per-partition
// parallelism) and PARTITION_PROCESS_CONCURRENCY (src/lib/concurrency.ts) for the
// concurrency cap. Elo and Massey run sequentially in this one process (not split
// into their own separate processes) specifically so they can share one
// PartitionMatchesCache -- both call getPartitionMatches with identical
// (seasonId, ageGroup, asOfDate) args moments apart, and this avoids fetching that
// same heavy match query twice. Safe to combine because Massey depends only on
// Colley (via withDivisionWeights), never on Elo's own output -- see
// computeMasseyRatings.ts's own doc comment.
async function main(): Promise<void> {
  const { seasonId, ageGroup, asOfDate, weekEndingDate } = JSON.parse(process.argv[2]) as {
    seasonId: string;
    ageGroup: number;
    asOfDate: string;
    weekEndingDate: string;
  };
  const cache: PartitionMatchesCache = new Map();
  const asOf = new Date(asOfDate);
  const weekEnding = new Date(weekEndingDate);
  await computeEloRatingsForPartition(seasonId, ageGroup, asOf, weekEnding, cache);
  await computeMasseyRatingsForPartition(seasonId, ageGroup, asOf, weekEnding, cache);
}

main()
  .then(() => {
    console.log(JSON.stringify({ ok: true, data: undefined }));
    process.exit(0);
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(0);
  });
