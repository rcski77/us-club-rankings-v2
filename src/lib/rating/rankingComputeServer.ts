// Unlike the *WorkerEntry.ts files this spawns as children (which inherit env vars
// from this process), this is the top-level process -- in local dev it's run
// directly (`npm run ranking-compute`), not as a child of the already env-loaded
// Next.js dev server, so it needs its own .env loading. No-ops harmlessly in prod,
// where env vars come from docker-compose's env_file/environment instead of a .env
// file (see prisma/seed.ts for the same pattern).
import "dotenv/config";
import { createServer } from "node:http";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrency, PARTITION_PROCESS_CONCURRENCY } from "@/lib/concurrency";
import { runInWorker } from "@/lib/import/runInWorker";

const PORT = Number(process.env.RANKING_COMPUTE_PORT ?? 4100);

/**
 * Runs the full Colley -> Elo+Massey recompute for one season, fanning each phase
 * out across age-group partitions as separate OS processes (see
 * PARTITION_PROCESS_CONCURRENCY's own comment for why that's what actually gets
 * genuine parallelism here, unlike the in-process async concurrency this replaced).
 *
 * Colley must finish for every age group before Elo/Massey starts for any of them --
 * not just convention, a real dependency: computeDivisionWeightsForPartition reads
 * TeamRatingHistory COLLEY rows for a given (seasonId, ageGroup), and a division can
 * span partitions via a playing-up team, so an Elo/Massey partition can depend on a
 * *different* partition's just-computed Colley results. Elo and Massey are mutually
 * independent of each other (Massey depends only on Colley), so they run together in
 * one process per partition -- see computeEloMasseyPartitionWorkerEntry.ts.
 */
async function runRecompute(seasonId: string, jobRunId: string): Promise<void> {
  try {
    const asOfDate = new Date();
    const weekEndingDate = new Date();
    const teamSeasons = await prisma.teamSeason.findMany({
      where: { seasonId },
      select: { ageGroup: true },
      distinct: ["ageGroup"],
    });
    const ageGroups = teamSeasons.map((ts) => ts.ageGroup);
    const dates = { asOfDate: asOfDate.toISOString(), weekEndingDate: weekEndingDate.toISOString() };

    await mapWithConcurrency(ageGroups, PARTITION_PROCESS_CONCURRENCY, (ageGroup) =>
      runInWorker("lib/rating/computeColleyPartitionWorkerEntry.ts", { seasonId, ageGroup, ...dates }),
    );
    await mapWithConcurrency(ageGroups, PARTITION_PROCESS_CONCURRENCY, (ageGroup) =>
      runInWorker("lib/rating/computeEloMasseyPartitionWorkerEntry.ts", { seasonId, ageGroup, ...dates }),
    );

    await prisma.jobRun.update({
      where: { id: jobRunId },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
  } catch (err) {
    console.error(`Ranking compute failed for season ${seasonId} (JobRun ${jobRunId}):`, err);
    await prisma.jobRun.update({
      where: { id: jobRunId },
      data: { status: "FAILED", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
    });
  }
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/recompute-ratings") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed: { seasonId?: string; jobRunId?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end("invalid JSON body");
        return;
      }
      const { seasonId, jobRunId } = parsed;
      if (!seasonId || !jobRunId) {
        res.writeHead(400).end("seasonId and jobRunId are required");
        return;
      }
      // Accept immediately -- the caller (team-rankings' recomputeAll, or
      // nightlyRecompute.ts) already created the JobRun row and either redirects
      // right away (manual trigger) or polls it (nightly), same fire-and-forget
      // shape the old execFile-based trigger had.
      res.writeHead(202).end();
      runRecompute(seasonId, jobRunId).catch((err) => {
        // runRecompute already catches and records failures against the JobRun row --
        // this only fires if that final catch block's own prisma call also fails.
        console.error(`Unhandled error recording recompute failure for JobRun ${jobRunId}:`, err);
      });
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => {
  console.log(`Ranking compute service listening on :${PORT}`);
});
