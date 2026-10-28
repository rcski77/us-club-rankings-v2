import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decodeAesTeamCode, isAesTeamCodeParseError } from "../src/lib/import/aesTeamCode";

/**
 * One-off repair (dry run by default): finds teams that a standings import merged
 * across age groups -- a team whose finishes in one season came from team codes of the
 * same gender but different ages (e.g. b12cattk2ov, b13cattk2ov ... b18cattk2ov all
 * landing on one Team). Codes differing only by gender (g/b) are the older, separate
 * cross-gender merge -- see splitMixedGenderTeams.ts -- and aren't touched here.
 *
 * How it happened: resolve.ts matched a returning team by lineageKey (club + region +
 * team number + gender, deliberately no age) to ANY team of that program not yet
 * enrolled this season. In the first event of a new season nobody is enrolled yet, so
 * a club's same-numbered squads at every age all matched one returning team. resolve.ts
 * now requires the returning team's prior-season age to fit (one younger, or the same)
 * and lets each be claimed by only one age per batch.
 *
 * --apply deletes, for each merged team, its finishes in that season's events and its
 * TeamSeason enrollment for that season. Then, for each event listed: start a new
 * Team Finishes import for each schedule link (tick "Event still in progress" if it
 * was), commit it, re-fetch its match results, and recompute ratings.
 *
 *   ./run-prod-script.sh prisma/repairMergedLineageTeams.ts
 *   ./run-prod-script.sh prisma/repairMergedLineageTeams.ts --apply
 */
async function main() {
  const apply = process.argv.includes("--apply");

  // Every committed standings row that landed on a team, with its event's season.
  const rows = await prisma.importRow.findMany({
    where: { matchedTeamId: { not: null }, importFile: { importBatch: { importType: "TEAM_FINISHES", status: "COMMITTED" } } },
    select: {
      matchedTeamId: true,
      teamCodeRaw: true,
      importFile: { select: { importBatch: { select: { event: { select: { id: true, name: true, seasonId: true, season: { select: { label: true } } } } } } } },
    },
  });

  type Group = { teamId: string; seasonId: string; seasonLabel: string; codes: Set<string>; events: Map<string, string> };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const event = r.importFile.importBatch.event;
    const key = `${r.matchedTeamId}|${event.seasonId}`;
    const g = groups.get(key) ?? {
      teamId: r.matchedTeamId!,
      seasonId: event.seasonId,
      seasonLabel: event.season.label,
      codes: new Set<string>(),
      events: new Map<string, string>(),
    };
    g.codes.add(r.teamCodeRaw.trim().toLowerCase());
    g.events.set(event.id, event.name);
    groups.set(key, g);
  }
  // Merged = two codes of the same gender with different ages on one team.
  const isAgeMerge = (codes: Set<string>) => {
    const agesByGender = new Map<string, Set<number>>();
    for (const code of codes) {
      const d = decodeAesTeamCode(code);
      if (isAesTeamCodeParseError(d)) continue;
      agesByGender.set(d.gender, (agesByGender.get(d.gender) ?? new Set()).add(d.ageGroup));
    }
    return [...agesByGender.values()].some((ages) => ages.size > 1);
  };
  const merged = [...groups.values()].filter((g) => isAgeMerge(g.codes));

  const teams = await prisma.team.findMany({
    where: { id: { in: merged.map((g) => g.teamId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(teams.map((t) => [t.id, t.name]));

  const affectedEvents = new Map<string, string>();
  for (const g of merged) {
    console.log(`${g.seasonLabel}  ${nameById.get(g.teamId) ?? g.teamId}: ${[...g.codes].sort().join(", ")}`);
    for (const [id, name] of g.events) affectedEvents.set(id, name);
  }
  console.log(`\n${merged.length} merged team(s) across ${affectedEvents.size} event(s):`);
  for (const name of [...affectedEvents.values()].sort()) console.log(`  - ${name}`);

  if (!apply || merged.length === 0) {
    if (merged.length > 0) console.log(`\nDry run -- rerun with --apply to remove them.`);
    return;
  }

  let finishes = 0;
  let enrollments = 0;
  for (const g of merged) {
    finishes += (
      await prisma.teamFinish.deleteMany({
        where: { teamId: g.teamId, division: { event: { seasonId: g.seasonId } } },
      })
    ).count;
    enrollments += (await prisma.teamSeason.deleteMany({ where: { teamId: g.teamId, seasonId: g.seasonId } })).count;
  }
  console.log(`\nDeleted ${finishes} finish(es) and ${enrollments} season enrollment(s). For each event above: start a new`);
  console.log(`Team Finishes import per schedule link, commit it, re-fetch match results, then recompute ratings.`);
}

main().finally(() => prisma.$disconnect());
