import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// One-off fix for merges performed before mergeClubsIntoTarget() (src/lib/club/
// mergeClubs.ts) was corrected to take the HIGHER of two clubs' legacy annual scores
// on a conflicting year, instead of leaving the loser's row orphaned on the retired
// source club based on arbitrary database row order (see docs/plan.md's
// "Club merge -- annual score conflict resolution fixed" note). Re-applies that same
// "higher wins" rule retroactively to every already-completed merge's leftover
// source-club rows, then reports which (target, year) pairs changed so an admin knows
// to recompute the 5-year aggregate afterward. Idempotent -- safe to re-run.
//
// Usage: npx tsx prisma/reconcileMergedClubAnnualScores.ts
//        ./run-prod-script.sh prisma/reconcileMergedClubAnnualScores.ts   (on prod)
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const targets = await prisma.club.findMany({
    where: { mergedClubs: { some: {} } },
    include: { mergedClubs: true },
  });

  let changedYears = 0;
  const affectedTargetIds = new Set<string>();

  for (const target of targets) {
    const sourceIds = target.mergedClubs.map((c) => c.id);

    const [targetAnnual, sourceAnnual] = await Promise.all([
      prisma.clubAnnualScore.findMany({ where: { clubId: target.id } }),
      prisma.clubAnnualScore.findMany({ where: { clubId: { in: sourceIds } } }),
    ]);
    const annualByYear = new Map(targetAnnual.map((r) => [r.year, r]));

    for (const row of sourceAnnual) {
      const existing = annualByYear.get(row.year);
      if (existing && row.totalPoints > existing.totalPoints) {
        console.log(
          `${target.name} (${target.id}) year ${row.year}: ${existing.totalPoints} -> ${row.totalPoints} (from retired club ${row.clubId})`,
        );
        await prisma.clubAnnualScore.update({
          where: { id: existing.id },
          data: { totalPoints: row.totalPoints, legacyRank: row.legacyRank, source: row.source },
        });
        annualByYear.set(row.year, { ...existing, totalPoints: row.totalPoints });
        changedYears += 1;
        affectedTargetIds.add(target.id);
      } else if (!existing) {
        // Shouldn't happen (a non-conflicting year should already have been moved by
        // the original merge), but move it now rather than leaving it stranded.
        console.log(`${target.name} (${target.id}) year ${row.year}: adopting orphaned row (no prior conflict)`);
        await prisma.clubAnnualScore.update({ where: { id: row.id }, data: { clubId: target.id } });
        annualByYear.set(row.year, row);
        changedYears += 1;
        affectedTargetIds.add(target.id);
      }
    }

    const [targetAgeGroup, sourceAgeGroup] = await Promise.all([
      prisma.clubAnnualAgeGroupScore.findMany({ where: { clubId: target.id } }),
      prisma.clubAnnualAgeGroupScore.findMany({ where: { clubId: { in: sourceIds } } }),
    ]);
    const ageGroupByKey = new Map(targetAgeGroup.map((r) => [`${r.year}:${r.ageGroup}`, r]));

    for (const row of sourceAgeGroup) {
      const key = `${row.year}:${row.ageGroup}`;
      const existing = ageGroupByKey.get(key);
      const existingPoints = existing?.clubPoints ?? -Infinity;
      const rowPoints = row.clubPoints ?? -Infinity;
      if (existing && rowPoints > existingPoints) {
        console.log(
          `${target.name} (${target.id}) year ${row.year} age ${row.ageGroup}: ${existingPoints} -> ${rowPoints}`,
        );
        await prisma.clubAnnualAgeGroupScore.update({
          where: { id: existing.id },
          data: {
            rank: row.rank,
            npsPoints: row.npsPoints,
            clubPoints: row.clubPoints,
            teamName: row.teamName,
            teamCode: row.teamCode,
          },
        });
        ageGroupByKey.set(key, { ...existing, clubPoints: row.clubPoints });
        changedYears += 1;
        affectedTargetIds.add(target.id);
      } else if (!existing) {
        console.log(`${target.name} (${target.id}) year ${row.year} age ${row.ageGroup}: adopting orphaned row`);
        await prisma.clubAnnualAgeGroupScore.update({ where: { id: row.id }, data: { clubId: target.id } });
        ageGroupByKey.set(key, row);
        changedYears += 1;
        affectedTargetIds.add(target.id);
      }
    }
  }

  console.log(`\n${changedYears} row(s) changed across ${affectedTargetIds.size} target club(s).`);
  if (affectedTargetIds.size > 0) {
    console.log(
      "Recompute the 5-year aggregate afterward (/admin/club-rankings/five-year, the current computable endYear -- 2021-2024 windows are frozen legacy imports) to refresh ClubFiveYearRankingResult from the corrected ClubAnnualScore rows.",
    );
  }

  await prisma.$disconnect();
}
main();
