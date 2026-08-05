import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * One-off data fix: every Division whose name contains "Boys" was created with
 * gender=GIRLS (the schema default) because its originating ImportRows predate
 * the parsedDivisionGender field and were never re-resolved (see
 * splitMixedGenderTeams.ts's doc comment -- this is what let boys finishes hide
 * from that script's Division.gender-based detection, e.g. "Mintonette Sports
 * m.61" showing up in "26 The Nike Classic / 16 Boys" tagged as a girls finish).
 *
 * Verified (2026-08-05) that every one of these divisions' committed TeamFinish
 * rows trace back to ImportRows with parsedGender="b" (the raw team-code gender
 * char) with no girls rows mixed in -- so this is a plain mistagging, not an
 * ambiguous split. Only touches Divisions matching that same verification, so
 * it's safe to re-run if a future import creates another one before resolve.ts
 * is corrected to backfill this properly going forward.
 */
async function main() {
  const divisions = await prisma.division.findMany({
    where: { name: { contains: "Boys", mode: "insensitive" }, gender: { not: "BOYS" } },
    select: { id: true, name: true, gender: true, event: { select: { name: true } } },
  });

  console.log(`${divisions.length} "Boys"-named division(s) not tagged gender=BOYS.`);

  let fixed = 0;
  let skipped = 0;
  for (const d of divisions) {
    const rows = await prisma.importRow.findMany({
      where: { matchedDivisionId: d.id },
      select: { parsedGender: true },
    });
    const finishCount = await prisma.teamFinish.count({ where: { divisionId: d.id } });
    // Only the rows that actually landed a committed finish count as evidence --
    // a division can accumulate stray matchedDivisionId rows across re-resolves
    // that never got committed.
    const nonBoys = rows.filter((r) => r.parsedGender && r.parsedGender.toLowerCase() !== "b").length;

    if (finishCount === 0) {
      console.log(`  SKIP ${d.event.name} / ${d.name}: no committed finishes, nothing to verify against.`);
      skipped += 1;
      continue;
    }
    if (nonBoys > 0) {
      console.log(`  SKIP ${d.event.name} / ${d.name}: ${nonBoys} non-boys row(s) among its ImportRows -- needs manual review, not a clean mistagging.`);
      skipped += 1;
      continue;
    }

    await prisma.division.update({ where: { id: d.id }, data: { gender: "BOYS" } });
    console.log(`  FIXED ${d.event.name} / ${d.name}: ${d.gender} -> BOYS (${finishCount} finishes).`);
    fixed += 1;
  }

  console.log(`\n${fixed} division(s) fixed, ${skipped} skipped for manual review.`);
}

main().finally(() => prisma.$disconnect());
