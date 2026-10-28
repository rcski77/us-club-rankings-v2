import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { DivisionGender } from "../src/generated/prisma/client";

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
 */
function genderFromCode(code: string | null): DivisionGender | null {
  const c = (code ?? "").trim().toLowerCase();
  if (c.startsWith("g")) return "GIRLS";
  if (c.startsWith("b")) return "BOYS";
  return null;
}

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
      team.seasons.map((ts) => genderFromCode(ts.externalTeamCode)).filter((g): g is DivisionGender => g != null),
    );
    if (codeGenders.size === 0) continue;
    if (codeGenders.size === 1 && codeGenders.has(team.gender)) continue;

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
}

main().finally(() => prisma.$disconnect());
