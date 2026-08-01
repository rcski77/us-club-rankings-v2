import { computeClubRankingForSeason } from "./computeClubRanking";
import type { ClubRankingSource } from "@/generated/prisma/enums";

// Entry point run in the child process spawned by computeClubRankingInWorker (see
// runInWorker.ts for why it's a separate execFile'd process). Importing
// computeClubRankingForSeason directly here -- rather than passing a Prisma client
// across the process boundary, which isn't possible -- pulls in "@/lib/prisma" fresh
// in this process's own module registry, so this process gets its own independent
// PrismaClient/pg connection pool, separate from the parent's.
async function main(): Promise<void> {
  const { seasonId, source } = JSON.parse(process.argv[2]) as { seasonId: string; source: ClubRankingSource };
  await computeClubRankingForSeason(seasonId, source);
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
