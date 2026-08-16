import { computeColleyRatings } from "./computeColleyRatings";

// One partition's worth of the Colley phase, run in its own OS process (spawned via
// execFile by rankingComputeServer.ts's mapWithConcurrency fan-out) so several
// partitions can compute/write genuinely in parallel -- see PARTITION_PROCESS_CONCURRENCY's
// own comment in src/lib/concurrency.ts for why that needs separate processes, not
// just async concurrency inside one process. Same JSON-argv-in,
// {ok,data|error}-JSON-out, explicit process.exit(0) contract every other
// *WorkerEntry.ts file uses -- see runInWorker.ts.
async function main(): Promise<void> {
  const { seasonId, ageGroup, asOfDate, weekEndingDate } = JSON.parse(process.argv[2]) as {
    seasonId: string;
    ageGroup: number;
    asOfDate: string;
    weekEndingDate: string;
  };
  await computeColleyRatings(seasonId, ageGroup, new Date(asOfDate), new Date(weekEndingDate));
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
