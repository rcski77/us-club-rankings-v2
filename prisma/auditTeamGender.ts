import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { applyDivisionGender, findMislabeledDivisions } from "../src/lib/divisionGenderAudit";
import { genderFromTeamCode, type RankingGender } from "../src/lib/teamGender";

/**
 * Audit (read-only by default): finds every Team whose Team.gender column disagrees
 * with the gender prefix of its TeamSeason externalTeamCode(s) -- AES's leading "g"/"b"
 * (see aesTeamCode.ts). Rankings partition by Team.gender (see docs/plan.md's
 * gender-partitioned rankings entry), so a mismatch puts a team in the wrong bucket.
 * Known sources: manually-created teams (no gender field before), teams matched via
 * overrideTeamId, and teams created before Team.gender existed.
 *
 * --apply: sets Team.gender from the codes when every coded season agrees. Teams
 * whose own codes disagree across seasons are reported only -- those are real
 * cross-gender merges for splitMixedGenderTeams.ts / manual handling.
 *
 * Then checks divisions: any whose Girls/Boys label disagrees with the majority of its
 * teams (see divisionGenderAudit.ts -- also browsable at /admin/division-genders).
 * Runs after the team pass since it reads Team.gender; --apply relabels those too.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      gender: true,
      club: { select: { name: true } },
      seasons: { select: { externalTeamCode: true, season: { select: { label: true } } } },
    },
  });

  let fixable = 0;
  let mixed = 0;
  for (const team of teams) {
    const codeGenders = new Set(
      team.seasons.map((ts) => genderFromTeamCode(ts.externalTeamCode)).filter((g): g is RankingGender => g != null),
    );
    if (codeGenders.size === 0) continue;
    if (codeGenders.size === 1 && codeGenders.has(team.gender as RankingGender)) continue;

    const codes = team.seasons.map((ts) => `${ts.season.label}: ${ts.externalTeamCode ?? "(none)"}`).join(", ");
    if (codeGenders.size > 1) {
      mixed += 1;
      console.log(`MIXED  ${team.name} (id ${team.id}, club "${team.club?.name ?? "unlinked"}") gender=${team.gender} codes=[${codes}]`);
      continue;
    }

    const codeGender = [...codeGenders][0];
    fixable += 1;
    console.log(`FIX    ${team.name} (id ${team.id}, club "${team.club?.name ?? "unlinked"}") ${team.gender} -> ${codeGender} codes=[${codes}]`);
    if (apply) await prisma.team.update({ where: { id: team.id }, data: { gender: codeGender } });
  }

  console.log(
    `\n${fixable} fixable mismatch(es)${apply ? " (applied)" : ""}, ${mixed} mixed-code team(s), out of ${teams.length} teams.`,
  );

  const divisions = await findMislabeledDivisions();
  console.log("");
  for (const d of divisions) {
    console.log(
      `DIVISION  ${d.eventName} / ${d.divisionName} (id ${d.divisionId}) ${d.currentGender} -> ${d.suggestedGender} (${d.girlsTeams} girls / ${d.boysTeams} boys teams)`,
    );
    if (apply) await applyDivisionGender(d.divisionId, d.suggestedGender);
  }
  console.log(`${divisions.length} mislabeled division(s)${apply ? " (applied)" : ""}.`);
}

main().finally(() => prisma.$disconnect());
