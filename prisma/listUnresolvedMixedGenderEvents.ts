import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { divisionGenderFromTeamCodeGender } from "../src/lib/import/aesTeamCode";

/**
 * Read-only companion to splitMixedGenderTeams.ts: for every "SKIP gender ...
 * no reconstructable ImportRow data" case that script reports, lists which
 * Event(s) that gender's Match rows belong to -- so an admin can decide which
 * events are worth a MATCH_RESULTS reimport (see the Florida Fest JNQ
 * precedent: reimporting fixed most, but not all, of that event's cases) versus
 * which are likely genuine cross-gender exhibition matches (nothing to fix --
 * already excluded from Elo/Colley/Massey) or upstream data gaps a reimport
 * can't recover. Mirrors splitMixedGenderTeams.ts's own reconstruction logic
 * exactly so the two scripts never disagree on what's reconstructable.
 */
async function main() {
  const teams = await prisma.team.findMany({
    include: {
      finishes: { include: { division: { select: { gender: true } } } },
      matchesAsTeamA: { select: { id: true, division: { select: { gender: true } }, event: { select: { id: true, name: true } } } },
      matchesAsTeamB: { select: { id: true, division: { select: { gender: true } }, event: { select: { id: true, name: true } } } },
      matchesWon: { select: { id: true, division: { select: { gender: true } } } },
    },
  });

  const mixed = teams.filter((t) => {
    const genders = new Set<string>();
    for (const f of t.finishes) genders.add(f.division.gender);
    for (const m of t.matchesAsTeamA) if (m.division) genders.add(m.division.gender);
    for (const m of t.matchesAsTeamB) if (m.division) genders.add(m.division.gender);
    return genders.size > 1;
  });

  const eventCounts = new Map<string, { name: string; teams: Set<string>; matches: number }>();
  let fullySkippedCount = 0;
  let partialSkipCount = 0;

  for (const team of mixed) {
    const rows = await prisma.importRow.findMany({
      where: { matchedTeamId: team.id },
      select: {
        parsedDivisionGender: true,
        parsedGender: true,
        parsedClubExternalCode: true,
        parsedRegionCodeFromCode: true,
        parsedTeamNumber: true,
        parsedTeamAgeGroup: true,
      },
    });

    const reconstructableGenders = new Set<string>();
    for (const row of rows) {
      const gender = row.parsedDivisionGender ?? (row.parsedGender ? divisionGenderFromTeamCodeGender(row.parsedGender) : null);
      if (!gender) continue;
      if (!row.parsedClubExternalCode || !row.parsedRegionCodeFromCode || !row.parsedTeamNumber || row.parsedTeamAgeGroup == null) continue;
      reconstructableGenders.add(gender);
    }

    if (reconstructableGenders.size === 0) {
      fullySkippedCount += 1;
      continue;
    }

    const financeGenders = new Set<string>();
    const finishCountByGender = new Map<string, number>();
    const bump = (g: string) => finishCountByGender.set(g, (finishCountByGender.get(g) ?? 0) + 1);
    for (const f of team.finishes) { financeGenders.add(f.division.gender); bump(f.division.gender); }
    for (const m of team.matchesAsTeamA) if (m.division) { financeGenders.add(m.division.gender); bump(m.division.gender); }
    for (const m of team.matchesAsTeamB) if (m.division) { financeGenders.add(m.division.gender); bump(m.division.gender); }
    for (const m of team.matchesWon) if (m.division) { financeGenders.add(m.division.gender); bump(m.division.gender); }

    const genderCandidates = [...financeGenders].sort((a, b) => {
      const diff = (finishCountByGender.get(b) ?? 0) - (finishCountByGender.get(a) ?? 0);
      if (diff !== 0) return diff;
      if (a === team.gender) return -1;
      if (b === team.gender) return 1;
      return a === "GIRLS" ? -1 : 1;
    });
    const otherGenders = genderCandidates.slice(1);

    for (const gender of otherGenders) {
      if (reconstructableGenders.has(gender)) continue; // splitMixedGenderTeams.ts will handle this one fine

      partialSkipCount += 1;
      const touchedMatches = [
        ...team.matchesAsTeamA.filter((m) => m.division?.gender === gender),
        ...team.matchesAsTeamB.filter((m) => m.division?.gender === gender),
      ];
      for (const m of touchedMatches) {
        const entry = eventCounts.get(m.event.id) ?? { name: m.event.name, teams: new Set(), matches: 0 };
        entry.teams.add(team.id);
        entry.matches += 1;
        eventCounts.set(m.event.id, entry);
      }
      if (touchedMatches.length === 0) {
        const entry = eventCounts.get("__no_match_data__") ?? { name: "(no Match rows -- finish-only, likely manual/non-AES)", teams: new Set(), matches: 0 };
        entry.teams.add(team.id);
        eventCounts.set("__no_match_data__", entry);
      }
    }
  }

  console.log(`${fullySkippedCount} team(s) fully skipped (no ImportRow data at all -- manual/non-AES, no event to reimport).`);
  console.log(`${partialSkipCount} gender-group skip(s) across ${eventCounts.size} distinct event(s):\n`);

  const sorted = [...eventCounts.entries()].sort((a, b) => b[1].teams.size - a[1].teams.size);
  for (const [, entry] of sorted) {
    console.log(`  ${entry.name}: ${entry.teams.size} team(s), ${entry.matches} match(es)`);
  }
}

main().finally(() => prisma.$disconnect());
