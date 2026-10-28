import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * One-off repair (dry run by default): finds provisional finishes (TeamFinish.rank
 * null, from an "event still in progress" standings import) that were committed into
 * a division whose name doesn't match the label the team was imported under.
 *
 * How it happened: resolve.ts used to reuse the event's only existing division with
 * the same (age, gender, tier) for any label -- so in THE Chicago Point Series, the
 * in-progress "18/17's THE Chicago Point Series" teams (no tier keyword -> 18 Boys
 * Open) merged into the already-imported "18's VSL" division. resolve.ts no longer
 * does that when the batch also carries the division's own exact label.
 *
 * --apply deletes those finishes. Then re-run the event's standings import with
 * "Event still in progress" ticked (creates the proper division) and re-fetch its
 * match results (moves the matches onto it), then recompute ratings.
 *
 *   ./run-prod-script.sh prisma/repairMergedProvisionalFinishes.ts
 *   ./run-prod-script.sh prisma/repairMergedProvisionalFinishes.ts --apply
 */
async function main() {
  const apply = process.argv.includes("--apply");

  const finishes = await prisma.teamFinish.findMany({
    where: { rank: null },
    select: {
      id: true,
      teamId: true,
      divisionId: true,
      team: { select: { name: true } },
      division: { select: { name: true, event: { select: { name: true } } } },
    },
  });

  const misgrouped: { id: string; where: string; label: string; team: string }[] = [];
  for (const f of finishes) {
    // The import row that committed this finish -- commit.ts records the final
    // division/team on it (matchedDivisionId/matchedTeamId).
    const row = await prisma.importRow.findFirst({
      where: { matchedDivisionId: f.divisionId, matchedTeamId: f.teamId },
      orderBy: { createdAt: "desc" },
      select: { ageGroupLabelRaw: true },
    });
    if (!row) continue;
    const label = row.ageGroupLabelRaw.trim();
    if (label.toLowerCase() === f.division.name.trim().toLowerCase()) continue;
    misgrouped.push({ id: f.id, where: `${f.division.event.name} / ${f.division.name}`, label, team: f.team.name });
  }

  const groups = new Map<string, typeof misgrouped>();
  for (const m of misgrouped) {
    const key = `${m.where}  <-  imported as "${m.label}"`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const [key, list] of groups) {
    console.log(`${key}: ${list.length} provisional finish(es), e.g. ${list.slice(0, 3).map((m) => m.team).join(", ")}`);
  }

  if (apply && misgrouped.length > 0) {
    const { count } = await prisma.teamFinish.deleteMany({ where: { id: { in: misgrouped.map((m) => m.id) } } });
    console.log(`\nDeleted ${count} misgrouped provisional finish(es). Now re-run each affected event's standings import`);
    console.log(`with "Event still in progress" ticked, re-fetch its match results, and recompute ratings.`);
  } else {
    console.log(`\n${misgrouped.length} misgrouped provisional finish(es)${misgrouped.length ? " -- rerun with --apply to delete them" : ""}.`);
  }
}

main().finally(() => prisma.$disconnect());
