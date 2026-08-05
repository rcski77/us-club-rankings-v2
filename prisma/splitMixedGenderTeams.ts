import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeLineageKey } from "../src/lib/import/lineageKey";
import { computeRanking } from "../src/lib/ranking/computeRanking";
import { divisionGenderFromTeamCodeGender } from "../src/lib/import/aesTeamCode";
import type { DivisionGender } from "../src/generated/prisma/enums";

/**
 * One-off data fix for the "Mintonette" cross-gender merge bug (see
 * docs/plan.md postmortem, resolve.ts/lineageKey.ts): before Team.gender and
 * lineageKey included gender, a club's boys and girls squads sharing a club
 * code/region/team-number/age collapsed onto one Team. This finds every Team
 * with mixed-gender TeamFinish/Match history, keeps the majority-gender group on
 * the existing Team, and splits every other gender into its own new Team --
 * moving TeamFinish, TeamSeason, Match (teamA/teamB/winner), ImportRow linkage,
 * and division-scoped AuditFlags to match.
 *
 * Reconstructs each split-off team's identity (club/region/teamNumber/age code)
 * from ImportRow's parsed fields (the ground truth every commit already wrote),
 * not by guessing -- a team's actual history is fully recoverable from its rows.
 *
 * Ranking impact: computeRanking() excludes a team entirely based on its
 * TeamSeason.externalTeamCode's gender prefix (see src/lib/teamGender.ts) --  a
 * single value per team per season. A mixed team's season row held whichever
 * gender's row committed last, so some of these teams were being wrongly
 * included in or excluded from girls rankings independent of this bug's more
 * visible "wrong finishes shown" symptom. Splitting fixes both; RankingResult is
 * recomputed for every touched (season, ageGroup) partition after a real run.
 *
 * Out of scope (left untouched, flagged for a manual follow-up recompute via the
 * existing admin actions): TeamRatingHistory / TeamEloMatchStep (Elo/Colley/
 * Massey -- delete-and-replace per season, rerun via "Recompute Ratings") and
 * ClubRankingResult(+Contribution) (Phase 7 rollup -- rerun via its own action).
 * Both are fully derived and safe to regenerate after this script's writes land.
 *
 * DRY RUN by default -- prints the full plan, writes nothing. Pass --apply to
 * actually commit (one transaction per team, so a failure on one team doesn't
 * block the rest).
 */

const APPLY = process.argv.includes("--apply");

type RepRow = {
  seasonId: string;
  ageGroup: number;
  teamNumber: string;
  externalTeamCode: string;
  clubExternalCode: string;
  regionCode: string;
  teamNameClean: string | null;
};

async function main() {
  const teams = await prisma.team.findMany({
    include: {
      finishes: {
        include: { division: { select: { id: true, gender: true, ageGroup: true, event: { select: { seasonId: true } } } } },
      },
      matchesAsTeamA: { select: { id: true, division: { select: { gender: true } } } },
      matchesAsTeamB: { select: { id: true, division: { select: { gender: true } } } },
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

  console.log(`${mixed.length} mixed-gender team(s) to process. Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const touchedRankingPartitions = new Set<string>(); // `${seasonId}|${ageGroup}`
  let splitCount = 0;
  let skippedForNoData = 0;

  for (const team of mixed) {
    // Ground truth for reconstructing each gender's identity: every ImportRow
    // that ever resolved to this team, grouped by (season, gender). Prefer the
    // resolved parsedDivisionGender, but fall back to decoding the raw
    // parsedGender char directly -- a substantial number of rows predate the
    // parsedDivisionGender field entirely (see fixBoysDivisionGender.ts's doc
    // comment) and have it null despite parsedGender being populated correctly.
    // A row with neither, or from a non-AES-coded source, can't contribute here
    // -- those genders/seasons are left alone and reported, not guessed at.
    const rows = await prisma.importRow.findMany({
      where: { matchedTeamId: team.id },
      include: { importFile: { include: { importBatch: { include: { event: true } } } } },
    });

    const repByGenderSeason = new Map<string, Map<string, RepRow>>(); // gender -> seasonId -> rep
    for (const row of rows) {
      const gender = row.parsedDivisionGender ?? (row.parsedGender ? divisionGenderFromTeamCodeGender(row.parsedGender) : null);
      if (!gender) continue;
      const seasonId = row.importFile.importBatch.event.seasonId;
      if (
        !row.parsedClubExternalCode ||
        !row.parsedRegionCodeFromCode ||
        !row.parsedTeamNumber ||
        row.parsedTeamAgeGroup == null
      ) {
        continue;
      }
      const bySeason = repByGenderSeason.get(gender) ?? new Map<string, RepRow>();
      if (!bySeason.has(seasonId)) {
        bySeason.set(seasonId, {
          seasonId,
          ageGroup: row.parsedTeamAgeGroup,
          teamNumber: row.parsedTeamNumber,
          externalTeamCode: row.teamCodeRaw,
          clubExternalCode: row.parsedClubExternalCode,
          regionCode: row.parsedRegionCodeFromCode,
          teamNameClean: row.teamNameClean,
        });
      }
      repByGenderSeason.set(gender, bySeason);
    }

    // Activity signal for picking the majority gender: finishes AND matches --
    // a team can be mixed purely via Match rows (match-results import resolving
    // this team into a boys-division match with no corresponding TeamFinish),
    // so counting finishes alone would silently miss that gender entirely.
    const financeGenders = new Set<string>();
    const finishCountByGender = new Map<string, number>();
    const bump = (gender: string) => finishCountByGender.set(gender, (finishCountByGender.get(gender) ?? 0) + 1);
    for (const f of team.finishes) {
      financeGenders.add(f.division.gender);
      bump(f.division.gender);
    }
    for (const m of team.matchesAsTeamA) if (m.division) { financeGenders.add(m.division.gender); bump(m.division.gender); }
    for (const m of team.matchesAsTeamB) if (m.division) { financeGenders.add(m.division.gender); bump(m.division.gender); }
    for (const m of team.matchesWon) if (m.division) { financeGenders.add(m.division.gender); bump(m.division.gender); }

    if (repByGenderSeason.size === 0) {
      console.log(`SKIP ${team.name} (${team.id}): no reconstructable ImportRow data (manual/non-AES team) -- needs manual review.`);
      skippedForNoData += 1;
      continue;
    }

    // Majority gender (by finish count) stays on the existing Team id; ties favor
    // the team's current Team.gender column, then GIRLS.
    const genderCandidates = [...financeGenders];
    genderCandidates.sort((a, b) => {
      const diff = (finishCountByGender.get(b) ?? 0) - (finishCountByGender.get(a) ?? 0);
      if (diff !== 0) return diff;
      if (a === team.gender) return -1;
      if (b === team.gender) return 1;
      return a === "GIRLS" ? -1 : 1;
    });
    const primaryGender = genderCandidates[0];
    const otherGenders = genderCandidates.slice(1);

    console.log(`\n${team.name} (${team.id}): keeping ${primaryGender} on this Team, splitting off ${otherGenders.join(", ")}.`);

    for (const gender of otherGenders) {
      const seasonMap = repByGenderSeason.get(gender);
      if (!seasonMap || seasonMap.size === 0) {
        console.log(`  SKIP gender ${gender}: no reconstructable ImportRow data for it -- left on ${team.name}, needs manual review.`);
        continue;
      }
      const anyRep = [...seasonMap.values()][0];
      const newLineageKey = computeLineageKey(anyRep.clubExternalCode, anyRep.regionCode, anyRep.teamNumber, gender);
      const newName = anyRep.teamNameClean ?? `${team.name} (${gender === "BOYS" ? "Boys" : "Girls"})`;

      const finishIdsToMove = team.finishes.filter((f) => f.division.gender === gender).map((f) => f.id);
      const matchAIdsToMove = team.matchesAsTeamA.filter((m) => m.division?.gender === gender).map((m) => m.id);
      const matchBIdsToMove = team.matchesAsTeamB.filter((m) => m.division?.gender === gender).map((m) => m.id);
      const matchWinIdsToMove = team.matchesWon.filter((m) => m.division?.gender === gender).map((m) => m.id);

      for (const [seasonId, rep] of seasonMap) {
        touchedRankingPartitions.add(`${seasonId}|${rep.ageGroup}`);
      }
      for (const f of team.finishes) {
        if (f.division.gender === primaryGender) touchedRankingPartitions.add(`${f.division.event.seasonId}|${f.division.ageGroup}`);
      }

      console.log(
        `  -> new Team "${newName}" gender=${gender} lineageKey="${newLineageKey}": ` +
          `${finishIdsToMove.length} finish(es), ${matchAIdsToMove.length + matchBIdsToMove.length} match side(s), ` +
          `${matchWinIdsToMove.length} match win(s), ${seasonMap.size} season(s).`,
      );
      splitCount += 1;

      if (!APPLY) continue;

      await prisma.$transaction(async (tx) => {
        const newTeam = await tx.team.create({
          data: { clubId: team.clubId, name: newName, lineageKey: newLineageKey, gender: gender as DivisionGender },
        });

        for (const [seasonId, rep] of seasonMap) {
          await tx.teamSeason.upsert({
            where: { teamId_seasonId: { teamId: newTeam.id, seasonId } },
            update: { ageGroup: rep.ageGroup, teamNumber: rep.teamNumber, externalTeamCode: rep.externalTeamCode },
            create: {
              teamId: newTeam.id,
              seasonId,
              ageGroup: rep.ageGroup,
              teamNumber: rep.teamNumber,
              externalTeamCode: rep.externalTeamCode,
            },
          });
        }

        if (finishIdsToMove.length > 0) {
          await tx.teamFinish.updateMany({ where: { id: { in: finishIdsToMove } }, data: { teamId: newTeam.id } });
        }
        for (const id of matchAIdsToMove) await tx.match.update({ where: { id }, data: { teamAId: newTeam.id } });
        for (const id of matchBIdsToMove) await tx.match.update({ where: { id }, data: { teamBId: newTeam.id } });
        for (const id of matchWinIdsToMove) await tx.match.update({ where: { id }, data: { winnerTeamId: newTeam.id } });

        await tx.importRow.updateMany({
          where: { matchedTeamId: team.id, parsedDivisionGender: gender as DivisionGender },
          data: { matchedTeamId: newTeam.id },
        });
        await tx.importRow.updateMany({
          where: { overrideTeamId: team.id, parsedDivisionGender: gender as DivisionGender },
          data: { overrideTeamId: newTeam.id },
        });

        const auditFlags = await tx.auditFlag.findMany({
          where: { teamId: team.id, divisionId: { not: null } },
          include: { division: { select: { gender: true } } },
        });
        const flagIdsToMove = auditFlags.filter((af) => af.division?.gender === gender).map((af) => af.id);
        if (flagIdsToMove.length > 0) {
          await tx.auditFlag.updateMany({ where: { id: { in: flagIdsToMove } }, data: { teamId: newTeam.id } });
        }
      });
    }

    // Fix the primary gender's own lineageKey/gender/TeamSeason data in case a
    // later-committed opposite-gender row had overwritten the shared season slot.
    if (APPLY) {
      const primarySeasons = repByGenderSeason.get(primaryGender);
      await prisma.$transaction(async (tx) => {
        const primaryRep = primarySeasons ? [...primarySeasons.values()][0] : null;
        await tx.team.update({
          where: { id: team.id },
          data: {
            gender: primaryGender as DivisionGender,
            ...(primaryRep
              ? { lineageKey: computeLineageKey(primaryRep.clubExternalCode, primaryRep.regionCode, primaryRep.teamNumber, primaryGender) }
              : {}),
          },
        });
        if (primarySeasons) {
          for (const [seasonId, rep] of primarySeasons) {
            await tx.teamSeason.upsert({
              where: { teamId_seasonId: { teamId: team.id, seasonId } },
              update: { ageGroup: rep.ageGroup, teamNumber: rep.teamNumber, externalTeamCode: rep.externalTeamCode },
              create: {
                teamId: team.id,
                seasonId,
                ageGroup: rep.ageGroup,
                teamNumber: rep.teamNumber,
                externalTeamCode: rep.externalTeamCode,
              },
            });
          }
        }
      });
    }
  }

  console.log(`\n${mixed.length - skippedForNoData}/${mixed.length} team(s) processed, ${splitCount} new team(s) ${APPLY ? "created" : "would be created"}.`);
  if (skippedForNoData > 0) {
    console.log(`${skippedForNoData} team(s) skipped entirely -- no ImportRow data to reconstruct from, needs manual review.`);
  }

  if (!APPLY) {
    console.log("\nDry run only -- rerun with --apply to commit these changes.");
    return;
  }

  console.log(`\nRecomputing rankings for ${touchedRankingPartitions.size} touched (season, ageGroup) partition(s)...`);
  for (const key of touchedRankingPartitions) {
    const [seasonId, ageGroupStr] = key.split("|");
    await computeRanking(seasonId, Number(ageGroupStr));
  }
  console.log("Done. Elo/Colley/Massey ratings and club rankings were NOT recomputed -- run those from their existing admin actions.");
}

main().finally(() => prisma.$disconnect());
