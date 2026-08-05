import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Read-only audit: finds every Team whose TeamFinish/Match history spans both
 * Division.gender values -- the "Mintonette" cross-gender merge bug (see
 * docs/plan.md postmortem). Team.gender/lineageKey now include gender going
 * forward (see resolve.ts/commit.ts), but this doesn't retroactively split teams
 * merged before that fix. Makes no writes; lists affected teams so we can decide
 * how to split each one (blast radius: TeamFinish, TeamSeason, Match x3,
 * RankingResult, TeamRatingHistory, TeamEloMatchStep x2, AuditFlag, ImportRow,
 * ClubRankingResultContribution).
 */
async function main() {
  const teams = await prisma.team.findMany({
    include: {
      club: true,
      finishes: { include: { division: { select: { gender: true, name: true, event: { select: { name: true } } } } } },
      matchesAsTeamA: { include: { division: { select: { gender: true } } } },
      matchesAsTeamB: { include: { division: { select: { gender: true } } } },
    },
  });

  console.log(`Scanning ${teams.length} teams...`);

  let mixedCount = 0;
  for (const team of teams) {
    const genders = new Set<string>();
    for (const f of team.finishes) genders.add(f.division.gender);
    for (const m of team.matchesAsTeamA) if (m.division) genders.add(m.division.gender);
    for (const m of team.matchesAsTeamB) if (m.division) genders.add(m.division.gender);

    if (genders.size <= 1) continue;

    mixedCount += 1;
    console.log(`\n--- ${team.name} (id ${team.id}, club "${team.club?.name ?? "unlinked"}") ---`);
    console.log(`  Team.gender column: ${team.gender} | lineageKey: ${team.lineageKey ?? "(none)"}`);
    console.log(`  Genders seen across finishes/matches: ${[...genders].join(", ")}`);
    const byGender = new Map<string, string[]>();
    for (const f of team.finishes) {
      const label = `${f.division.event.name} / ${f.division.name}`;
      const list = byGender.get(f.division.gender) ?? [];
      list.push(label);
      byGender.set(f.division.gender, list);
    }
    for (const [gender, labels] of byGender) {
      console.log(`  ${gender} finishes (${labels.length}):`);
      for (const label of labels) console.log(`    - ${label}`);
    }
  }

  console.log(`\n${mixedCount} team(s) with mixed-gender history out of ${teams.length} total.`);
}

main().finally(() => prisma.$disconnect());
