import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeRanking } from "../src/lib/ranking/computeRanking";
import { listRankingPartitions } from "../src/lib/ranking/rankingPartitions";
import { mapWithConcurrency, PARTITION_PROCESS_CONCURRENCY } from "../src/lib/concurrency";
import { runInWorker } from "../src/lib/import/runInWorker";
import { pruneRatingHistory } from "../src/lib/rating/pruneRatingHistory";

/**
 * Recomputes every team ranking for one season, girls and boys: NPS (computeRanking)
 * for every (ageGroup, gender) partition, then Colley -> Elo+Massey the same way the
 * ranking-compute service does (see rankingComputeServer.ts). NPS normally only
 * recomputes on division confirm/unlock or import commit, so this is how a season's
 * boys NPS rankings get filled in the first time, after the gender partition landed
 * (see docs/plan.md).
 *
 * Usage: npm run db:recompute-team-rankings [-- <seasonId>]   (defaults to the active season)
 */
async function main() {
  const seasonId =
    process.argv[2] ?? (await prisma.season.findFirst({ where: { isActive: true }, select: { id: true } }))?.id;
  if (!seasonId) throw new Error("No seasonId given and no active season found.");

  // Logged like the Recompute ratings button's runs, so it shows up on /admin/job-runs
  // (a long recompute loads the shared database -- staff should be able to see one ran).
  const jobRun = await prisma.jobRun.create({
    data: { kind: "RATINGS_RECOMPUTE", seasonId, detail: "db:recompute-team-rankings (incl. NPS)", triggeredBy: "script" },
  });

  try {
    const partitions = await listRankingPartitions(seasonId);
    console.log(`Recomputing ${partitions.length} partition(s) for season ${seasonId}...`);

    for (const { ageGroup, gender } of partitions) await computeRanking(seasonId, ageGroup, gender);
    console.log("NPS done.");

    const now = new Date().toISOString();
    const dates = { asOfDate: now, weekEndingDate: now };
    await mapWithConcurrency(partitions, PARTITION_PROCESS_CONCURRENCY, ({ ageGroup, gender }) =>
      runInWorker("lib/rating/computeColleyPartitionWorkerEntry.ts", { seasonId, ageGroup, gender, ...dates }),
    );
    console.log("Colley done.");
    await mapWithConcurrency(partitions, PARTITION_PROCESS_CONCURRENCY, ({ ageGroup, gender }) =>
      runInWorker("lib/rating/computeEloMasseyPartitionWorkerEntry.ts", { seasonId, ageGroup, gender, ...dates }),
    );
    console.log("Elo + Massey done.");
    console.log(`Pruned ${await pruneRatingHistory(seasonId)} old rating snapshot row(s).`);

    await prisma.jobRun.update({ where: { id: jobRun.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "FAILED", finishedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

main().finally(() => prisma.$disconnect());
