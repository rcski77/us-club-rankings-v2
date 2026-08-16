import { prisma } from "@/lib/prisma";
import { computeDivisionScoringSuggestion } from "./computeDivisionScoringSuggestion";

// Entry point run in the child process spawned by computeAnalysisForSeasonInWorker
// (see runInWorker.ts for why it's a separate execFile'd process). The season-wide
// version of admin/analysis/[seasonId]/[ageGroup]/page.tsx's runAnalysisForAll --
// same per-division computeDivisionScoringSuggestion loop, just over every division
// in the season instead of one age group's worth, so it needs the same off-request-
// thread treatment computeClubRankingWorkerEntry.ts already uses for season-wide
// loops (see that file's own comment for why).
async function main(): Promise<void> {
  const { seasonId } = JSON.parse(process.argv[2]) as { seasonId: string };

  const divisions = await prisma.division.findMany({
    where: { event: { seasonId } },
    select: { id: true, scoringStatus: true },
  });

  for (const division of divisions) {
    // CONFIRMED divisions get their stats refreshed (as new match data lands) without
    // reopening finish/band editing -- see computeDivisionScoringSuggestion's
    // preserveStatus doc comment.
    await computeDivisionScoringSuggestion(division.id, {
      preserveStatus: division.scoringStatus === "CONFIRMED",
    });
  }
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
