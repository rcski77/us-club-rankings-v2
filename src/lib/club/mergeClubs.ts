// True-merge orchestration for consolidating a real-world club merger or a
// code-change situation (e.g. "SC Rockstar" combining two previously-separate,
// previously-ranked clubs under one new code -- see docs/plan.md's "No mechanism to
// merge/alias a club" note). One or more SOURCE Club rows are folded into a single
// surviving TARGET: every Team (and therefore every downstream ranking/rating that's
// keyed off Team, which is everything except the legacy annual-score import) moves to
// the target, so the next ranking/rating recompute already treats the merged history
// as one program with no further code changes needed. Source rows are kept (not
// deleted) and marked retired via mergedIntoClubId/isActive, for audit trail and so
// existing FK references (ImportRow, AuditFlag) stay valid.
import { prisma } from "@/lib/prisma";

export type ClubMergeConflict = {
  model: "ClubAnnualScore" | "ClubAnnualAgeGroupScore";
  sourceClubId: string;
  year: number;
  ageGroup?: number;
};

export type ClubMergeResult = {
  teamsMoved: number;
  contactsMoved: number;
  annualScoresMoved: number;
  annualAgeGroupScoresMoved: number;
  conflicts: ClubMergeConflict[];
};

export async function mergeClubsIntoTarget(
  targetClubId: string,
  sourceClubIds: string[],
): Promise<ClubMergeResult> {
  const uniqueSourceIds = [...new Set(sourceClubIds)].filter((id) => id !== targetClubId);
  if (uniqueSourceIds.length === 0) {
    throw new Error("Select at least one other club to merge into this one.");
  }

  const [target, sources] = await Promise.all([
    prisma.club.findUniqueOrThrow({ where: { id: targetClubId } }),
    prisma.club.findMany({ where: { id: { in: uniqueSourceIds } } }),
  ]);
  if (target.mergedIntoClubId) {
    throw new Error(
      `"${target.name}" has itself already been merged into another club -- pick the surviving club as the target instead.`,
    );
  }
  if (sources.length !== uniqueSourceIds.length) {
    throw new Error("One or more selected clubs could not be found.");
  }
  const alreadyMerged = sources.find((s) => s.mergedIntoClubId);
  if (alreadyMerged) {
    throw new Error(`"${alreadyMerged.name}" has already been merged into another club.`);
  }

  // ClubAnnualScore/ClubAnnualAgeGroupScore are the legacy 5-year-import rows, unique
  // per (clubId, year[, ageGroup]) -- unlike everything else being moved, these can
  // genuinely collide if both the target and a source club already have a row for the
  // same year (e.g. two real, separately-ranked programs that both existed in an
  // overlapping year before merging). Rather than guess which one should win, a
  // colliding row is left on the source club for an admin to resolve by hand, and
  // reported back as a conflict. ClubFiveYearRankingResult is NOT migrated here --
  // it's a delete-and-replace computed rollup of ClubAnnualScore (see
  // computeFiveYearClubRanking.ts), so it just needs a recompute after the merge to
  // pick up the moved rows.
  const [existingAnnual, existingAgeGroup, sourceAnnual, sourceAgeGroup] = await Promise.all([
    prisma.clubAnnualScore.findMany({ where: { clubId: targetClubId }, select: { year: true } }),
    prisma.clubAnnualAgeGroupScore.findMany({
      where: { clubId: targetClubId },
      select: { year: true, ageGroup: true },
    }),
    prisma.clubAnnualScore.findMany({ where: { clubId: { in: uniqueSourceIds } } }),
    prisma.clubAnnualAgeGroupScore.findMany({ where: { clubId: { in: uniqueSourceIds } } }),
  ]);

  const takenYears = new Set(existingAnnual.map((r) => r.year));
  const conflicts: ClubMergeConflict[] = [];
  const annualScoreIdsToMove: string[] = [];
  for (const row of sourceAnnual) {
    if (takenYears.has(row.year)) {
      conflicts.push({ model: "ClubAnnualScore", sourceClubId: row.clubId, year: row.year });
    } else {
      annualScoreIdsToMove.push(row.id);
      takenYears.add(row.year); // guards against two source clubs both having this year
    }
  }

  const takenAgeGroupYears = new Set(existingAgeGroup.map((r) => `${r.year}:${r.ageGroup}`));
  const ageGroupIdsToMove: string[] = [];
  for (const row of sourceAgeGroup) {
    const key = `${row.year}:${row.ageGroup}`;
    if (takenAgeGroupYears.has(key)) {
      conflicts.push({
        model: "ClubAnnualAgeGroupScore",
        sourceClubId: row.clubId,
        year: row.year,
        ageGroup: row.ageGroup,
      });
    } else {
      ageGroupIdsToMove.push(row.id);
      takenAgeGroupYears.add(key);
    }
  }

  const [teams, contacts, annualScores, annualAgeGroupScores] = await prisma.$transaction([
    prisma.team.updateMany({ where: { clubId: { in: uniqueSourceIds } }, data: { clubId: targetClubId } }),
    prisma.clubContact.updateMany({
      where: { clubId: { in: uniqueSourceIds } },
      data: { clubId: targetClubId },
    }),
    prisma.clubAnnualScore.updateMany({
      where: { id: { in: annualScoreIdsToMove } },
      data: { clubId: targetClubId },
    }),
    prisma.clubAnnualAgeGroupScore.updateMany({
      where: { id: { in: ageGroupIdsToMove } },
      data: { clubId: targetClubId },
    }),
    prisma.club.updateMany({
      where: { id: { in: uniqueSourceIds } },
      data: { isActive: false, mergedIntoClubId: targetClubId },
    }),
  ]);

  return {
    teamsMoved: teams.count,
    contactsMoved: contacts.count,
    annualScoresMoved: annualScores.count,
    annualAgeGroupScoresMoved: annualAgeGroupScores.count,
    conflicts,
  };
}
