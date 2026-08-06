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

export type ClubMergeYearResolution = {
  model: "ClubAnnualScore" | "ClubAnnualAgeGroupScore";
  sourceClubId: string;
  year: number;
  ageGroup?: number;
  targetValue: number;
  sourceValue: number;
  winner: "target" | "source"; // which value ended up on the target club
};

export type ClubMergeResult = {
  teamsMoved: number;
  contactsMoved: number;
  annualScoresMoved: number;
  annualScoresOverridden: number;
  annualAgeGroupScoresMoved: number;
  annualAgeGroupScoresOverridden: number;
  yearResolutions: ClubMergeYearResolution[];
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
  // overlapping year before merging). Per explicit user decision (the real SC
  // Rockstar/Mizuno Long Beach/SCVC case): a colliding year takes the HIGHER of the
  // two scores onto the target rather than an arbitrary "first source processed
  // wins" (the original version of this function left the loser's row orphaned on
  // the source club with no lasting visibility once the merge's one-time success
  // banner was gone -- confirmed as a real bug from prod/dev disagreeing on which of
  // two real clubs' history survived, purely due to database row order). Every
  // colliding year is reported back in yearResolutions for transparency, whichever
  // way it resolved -- not just the years where the source's value won.
  // ClubFiveYearRankingResult is NOT recomputed here -- it's a delete-and-replace
  // rollup of ClubAnnualScore (see computeFiveYearClubRanking.ts), so a normal
  // recompute after the merge picks up whatever ClubAnnualScore ends up with.
  const [existingAnnual, existingAgeGroup, sourceAnnual, sourceAgeGroup] = await Promise.all([
    prisma.clubAnnualScore.findMany({ where: { clubId: targetClubId } }),
    prisma.clubAnnualAgeGroupScore.findMany({ where: { clubId: targetClubId } }),
    prisma.clubAnnualScore.findMany({ where: { clubId: { in: uniqueSourceIds } } }),
    prisma.clubAnnualAgeGroupScore.findMany({ where: { clubId: { in: uniqueSourceIds } } }),
  ]);

  const yearResolutions: ClubMergeYearResolution[] = [];

  const annualByYear = new Map(existingAnnual.map((r) => [r.year, r]));
  const annualScoreIdsToMove: string[] = [];
  const annualScoreOverrides: { id: string; totalPoints: number; legacyRank: number | null; source: string }[] = [];
  for (const row of sourceAnnual) {
    const existingRow = annualByYear.get(row.year);
    if (!existingRow) {
      annualScoreIdsToMove.push(row.id);
      annualByYear.set(row.year, row); // guards against a later source also claiming this year
      continue;
    }
    if (row.totalPoints > existingRow.totalPoints) {
      annualScoreOverrides.push({
        id: existingRow.id,
        totalPoints: row.totalPoints,
        legacyRank: row.legacyRank,
        source: row.source,
      });
      yearResolutions.push({
        model: "ClubAnnualScore",
        sourceClubId: row.clubId,
        year: row.year,
        targetValue: existingRow.totalPoints,
        sourceValue: row.totalPoints,
        winner: "source",
      });
      annualByYear.set(row.year, { ...existingRow, totalPoints: row.totalPoints }); // so a 3rd source competing for this year compares against the new best
    } else {
      yearResolutions.push({
        model: "ClubAnnualScore",
        sourceClubId: row.clubId,
        year: row.year,
        targetValue: existingRow.totalPoints,
        sourceValue: row.totalPoints,
        winner: "target",
      });
    }
  }

  const ageGroupByKey = new Map(existingAgeGroup.map((r) => [`${r.year}:${r.ageGroup}`, r]));
  const ageGroupIdsToMove: string[] = [];
  const ageGroupOverrides: {
    id: string;
    rank: number | null;
    npsPoints: number | null;
    clubPoints: number | null;
    teamName: string | null;
    teamCode: string | null;
  }[] = [];
  for (const row of sourceAgeGroup) {
    const key = `${row.year}:${row.ageGroup}`;
    const existingRow = ageGroupByKey.get(key);
    if (!existingRow) {
      ageGroupIdsToMove.push(row.id);
      ageGroupByKey.set(key, row);
      continue;
    }
    const existingPoints = existingRow.clubPoints ?? -Infinity;
    const rowPoints = row.clubPoints ?? -Infinity;
    if (rowPoints > existingPoints) {
      ageGroupOverrides.push({
        id: existingRow.id,
        rank: row.rank,
        npsPoints: row.npsPoints,
        clubPoints: row.clubPoints,
        teamName: row.teamName,
        teamCode: row.teamCode,
      });
      yearResolutions.push({
        model: "ClubAnnualAgeGroupScore",
        sourceClubId: row.clubId,
        year: row.year,
        ageGroup: row.ageGroup,
        targetValue: existingPoints,
        sourceValue: rowPoints,
        winner: "source",
      });
      ageGroupByKey.set(key, { ...existingRow, clubPoints: row.clubPoints });
    } else {
      yearResolutions.push({
        model: "ClubAnnualAgeGroupScore",
        sourceClubId: row.clubId,
        year: row.year,
        ageGroup: row.ageGroup,
        targetValue: existingPoints,
        sourceValue: rowPoints,
        winner: "target",
      });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const teams = await tx.team.updateMany({
      where: { clubId: { in: uniqueSourceIds } },
      data: { clubId: targetClubId },
    });
    const contacts = await tx.clubContact.updateMany({
      where: { clubId: { in: uniqueSourceIds } },
      data: { clubId: targetClubId },
    });
    const annualScoresMoved = await tx.clubAnnualScore.updateMany({
      where: { id: { in: annualScoreIdsToMove } },
      data: { clubId: targetClubId },
    });
    for (const o of annualScoreOverrides) {
      await tx.clubAnnualScore.update({
        where: { id: o.id },
        data: { totalPoints: o.totalPoints, legacyRank: o.legacyRank, source: o.source },
      });
    }
    const ageGroupScoresMoved = await tx.clubAnnualAgeGroupScore.updateMany({
      where: { id: { in: ageGroupIdsToMove } },
      data: { clubId: targetClubId },
    });
    for (const o of ageGroupOverrides) {
      await tx.clubAnnualAgeGroupScore.update({
        where: { id: o.id },
        data: {
          rank: o.rank,
          npsPoints: o.npsPoints,
          clubPoints: o.clubPoints,
          teamName: o.teamName,
          teamCode: o.teamCode,
        },
      });
    }
    await tx.club.updateMany({
      where: { id: { in: uniqueSourceIds } },
      data: { isActive: false, mergedIntoClubId: targetClubId },
    });

    return { teamsMoved: teams.count, contactsMoved: contacts.count, annualScoresMoved: annualScoresMoved.count, ageGroupScoresMoved: ageGroupScoresMoved.count };
  });

  return {
    teamsMoved: result.teamsMoved,
    contactsMoved: result.contactsMoved,
    annualScoresMoved: result.annualScoresMoved,
    annualScoresOverridden: annualScoreOverrides.length,
    annualAgeGroupScoresMoved: result.ageGroupScoresMoved,
    annualAgeGroupScoresOverridden: ageGroupOverrides.length,
    yearResolutions,
  };
}
