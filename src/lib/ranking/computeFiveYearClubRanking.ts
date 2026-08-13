import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { computeFiveYearClubScore, rankFiveYearClubs, FIVE_YEAR_WEIGHTS } from "./fiveYearClubRanking";
import type { ClubRankingSource } from "@/generated/prisma/enums";

const ALGORITHM_VERSION = "phase-5yr-v1";
// Marks a ClubFiveYearRankingResult row written directly by
// prisma/importLegacyFiveYearRankings.ts (the legacy workbook's already-final
// 2021-2024 windows -- no underlying 2017-2020 data exists in this app to recompute
// them from) rather than by computeFiveYearClubRankingForYear below. Exported so the
// import script and this file share one literal instead of two that could drift.
export const LEGACY_IMPORT_ALGORITHM_VERSION = "legacy-import";

/**
 * Folds a real computed season (this app's own ClubRankingResult, not the legacy
 * workbook) into ClubAnnualScore as a per-club row, keyed by the season's ending year
 * (season.endDate's year -- e.g. "2025-2026" ends in 2026) -- this is the "future
 * COMPUTED value" ClubAnnualScore.source's own comment already anticipated, so
 * computeFiveYearClubRankingForYear needs no change to pick up new seasons as they
 * happen; it only ever reads ClubAnnualScore.
 *
 * `source` picks which of ClubRankingResult's two per-team rankings feeds the sync --
 * NPS reproduces the legacy per-year methodology exactly (see clubRanking.ts's
 * computeClubScore), while COMBINED is this app's own newer blend (50% NPS rank + 50%
 * Power Rankings' Avg Rank). Which one is "right" for a given year is a staff call,
 * not something this function decides -- it just records which pipeline produced the
 * row as source: "COMPUTED_NPS" | "COMPUTED_COMBINED", so a year computed one way
 * doesn't get silently confused for a year computed the other way, and years can mix
 * sources across the 5-year window (e.g. 2026 on Combined, still-2021-2025 legacy-
 * imported) without any ambiguity about what each one represents.
 *
 * Never overwrites a LEGACY_IMPORT row -- those are 2021-2025's ground truth from the
 * source workbook and have no underlying event data in this app to recompute from;
 * only a year with no legacy row (or a previous COMPUTED_* row, safe to refresh/
 * re-sync under a different source) gets written.
 */
export async function syncClubAnnualScoreFromSeason(
  seasonId: string,
  source: ClubRankingSource = "COMBINED",
) {
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  const year = season.endDate.getFullYear();
  const annualScoreSource = source === "COMBINED" ? "COMPUTED_COMBINED" : "COMPUTED_NPS";

  const results = await prisma.clubRankingResult.findMany({
    where: { seasonId, source },
    select: { clubId: true, totalPoints: true, rank: true },
  });

  const existing = await prisma.clubAnnualScore.findMany({
    where: { year, clubId: { in: results.map((r) => r.clubId) } },
    select: { clubId: true, source: true },
  });
  const legacyClubIds = new Set(existing.filter((e) => e.source === "LEGACY_IMPORT").map((e) => e.clubId));

  let written = 0;
  for (const r of results) {
    if (legacyClubIds.has(r.clubId)) continue;
    await prisma.clubAnnualScore.upsert({
      where: { clubId_year: { clubId: r.clubId, year } },
      update: { totalPoints: r.totalPoints, legacyRank: r.rank, source: annualScoreSource },
      create: {
        clubId: r.clubId,
        year,
        totalPoints: r.totalPoints,
        legacyRank: r.rank,
        source: annualScoreSource,
      },
    });
    written += 1;
  }

  return { year, written, skippedLegacy: legacyClubIds.size, source: annualScoreSource };
}

/**
 * Recomputes the 5-year aggregate club ranking for the window [endYear-4, endYear],
 * from whichever ClubAnnualScore rows exist in that window -- legacy-imported for
 * 2021-2025 today (see prisma/importLegacyClubRankings.ts), with room for future
 * years to add their own rows (source: "COMPUTED") without any change here.
 *
 * Refuses to run against an endYear that's a legacy-imported window (2021-2024 --
 * see prisma/importLegacyFiveYearRankings.ts): this app only has real ClubAnnualScore
 * data starting 2021, so "recomputing" e.g. 2022 would use just two real years
 * (2021-2022) padded with three 0s for 2018-2020's missing data, silently producing a
 * wrong result that looks plausible. Server-side, not just a UI affordance -- see the
 * admin page's own disabled-button treatment for the same guard.
 */
export async function computeFiveYearClubRankingForYear(
  endYear: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existingLegacyRow = await prisma.clubFiveYearRankingResult.findFirst({
    where: { endYear, algorithmVersion: LEGACY_IMPORT_ALGORITHM_VERSION },
    select: { id: true },
  });
  if (existingLegacyRow) {
    return {
      ok: false,
      reason: `${endYear} is a legacy-imported window with no underlying 2017-2020 data in this app to recompute it from.`,
    };
  }

  const years = Array.from({ length: FIVE_YEAR_WEIGHTS.length }, (_, i) => endYear - (FIVE_YEAR_WEIGHTS.length - 1 - i));

  const scores = await prisma.clubAnnualScore.findMany({
    where: { year: { in: years } },
    select: { clubId: true, year: true, totalPoints: true },
  });

  // A club with rankingGroupPrimaryClubId set stays fully independent (own teams, own
  // imports -- see the field's comment on Club) but should be scored as one program
  // for club-rankings purposes, same as computeClubRankingForSeason() already does
  // for the current season. Extends that here: a year's score is redirected onto the
  // group's primary club, and where both the primary and a member have a real score
  // for the same year, the higher one wins -- same "best of the two" rule already
  // used for merge-conflict years (mergeClubs.ts) and for picking a group's
  // best-per-age-group team in the current season, not a sum (these are already
  // final, best-5-of-6-derived scores, not additive raw points).
  //
  // A club with mergedIntoClubId set is retired outright -- mergeClubsIntoTarget
  // moves its ClubAnnualScore rows onto the surviving club already, EXCEPT for a
  // year where both clubs already had their own row before the merge (the merge
  // keeps the higher value on the target but leaves the loser's original row in
  // place on the now-inactive source, for audit trail). Without this redirect that
  // leftover row would still surface here as a separate, partial "club" in the 5-year
  // ranking. mergedIntoClubId is resolved with the same higher-wins rule (and takes
  // priority over rankingGroupPrimaryClubId -- a merged-away club can't also be an
  // independent ranking-group member).
  const clubIds = [...new Set(scores.map((s) => s.clubId))];
  const clubs = clubIds.length
    ? await prisma.club.findMany({
        where: { id: { in: clubIds } },
        select: { id: true, mergedIntoClubId: true, rankingGroupPrimaryClubId: true },
      })
    : [];
  const rankingClubId = new Map(
    clubs.map((c) => [c.id, c.mergedIntoClubId ?? c.rankingGroupPrimaryClubId ?? c.id]),
  );

  const pointsByClub = new Map<string, Partial<Record<number, number>>>();
  for (const s of scores) {
    const targetClubId = rankingClubId.get(s.clubId) ?? s.clubId;
    const entry = pointsByClub.get(targetClubId) ?? {};
    const existing = entry[s.year];
    if (existing === undefined || s.totalPoints > existing) {
      entry[s.year] = s.totalPoints;
    }
    pointsByClub.set(targetClubId, entry);
  }

  const scored = Array.from(pointsByClub.entries()).map(([clubId, pointsByYear]) => {
    const score = computeFiveYearClubScore(pointsByYear, years);
    return { clubId, ...score };
  });

  const ranked = rankFiveYearClubs(scored);

  // Same client-generated-id + createMany batching pattern as
  // computeClubRankingForSeason (computeClubRanking.ts) -- this dataset is much
  // smaller (hundreds of clubs, not thousands), but the pattern costs nothing to
  // reuse and keeps this consistent with the rest of the codebase.
  const rowsWithIds = ranked.map((club) => ({ ...club, id: randomUUID() }));

  await prisma.$transaction(async (tx) => {
    await tx.clubFiveYearRankingResult.deleteMany({ where: { endYear } });
    if (rowsWithIds.length === 0) return;

    await tx.clubFiveYearRankingResult.createMany({
      data: rowsWithIds.map((club) => ({
        id: club.id,
        endYear,
        clubId: club.clubId,
        totalPoints: club.totalPoints,
        rank: club.rank,
        algorithmVersion: ALGORITHM_VERSION,
      })),
    });
    await tx.clubFiveYearRankingResultContribution.createMany({
      data: rowsWithIds.flatMap((club) =>
        club.contributions.map((c) => ({
          clubFiveYearRankingResultId: club.id,
          year: c.year,
          weight: c.weight,
          points: c.points,
          weightedPoints: c.weightedPoints,
          present: c.present,
        })),
      ),
    });
  });

  return { ok: true };
}

export type ResolvedFiveYearRanking = {
  clubId: string; // the surviving/target club's id -- never a merged-away or
  // ranking-group-member club, even if that club's own row is the one that won
  totalPoints: number;
  rank: number;
  sourceRowId: string; // whichever ClubFiveYearRankingResult row (target's own, or a
  // merged-away/grouped club's) had the higher totalPoints -- contributions/breakdown
  // for this club at this endYear come from that row.
};

/**
 * Read-time equivalent of computeFiveYearClubRankingForYear's merge/ranking-group
 * redirect (same higher-of-the-two-wins rule), for reading back an endYear whose
 * stored ClubFiveYearRankingResult rows predate that redirect -- or, for a frozen
 * legacy-imported window (2021-2024, see LEGACY_IMPORT_ALGORITHM_VERSION), can never
 * be recomputed at all. Every page/export that reads a 5-year window should call this
 * instead of querying ClubFiveYearRankingResult directly and filtering out merged
 * clubs afterward: the stored `rank` column was computed against a wider set that
 * included the now-excluded club as its own separate entry, so filtering it out
 * without renumbering leaves gaps in the rank sequence -- e.g. a capped "top 100" list
 * silently shrinks to 98 rows instead of promoting the next two clubs up to fill the
 * merged clubs' old slots.
 */
export async function getResolvedFiveYearRanking(endYear: number): Promise<ResolvedFiveYearRanking[]> {
  const rows = await prisma.clubFiveYearRankingResult.findMany({
    where: { endYear },
    select: { id: true, clubId: true, totalPoints: true },
  });
  if (rows.length === 0) return [];

  const clubIds = [...new Set(rows.map((r) => r.clubId))];
  const clubs = await prisma.club.findMany({
    where: { id: { in: clubIds } },
    select: { id: true, mergedIntoClubId: true, rankingGroupPrimaryClubId: true },
  });
  const targetOf = new Map(clubs.map((c) => [c.id, c.mergedIntoClubId ?? c.rankingGroupPrimaryClubId ?? c.id]));

  const bestByTarget = new Map<string, { totalPoints: number; sourceRowId: string }>();
  for (const r of rows) {
    const targetClubId = targetOf.get(r.clubId) ?? r.clubId;
    const existing = bestByTarget.get(targetClubId);
    if (!existing || r.totalPoints > existing.totalPoints) {
      bestByTarget.set(targetClubId, { totalPoints: r.totalPoints, sourceRowId: r.id });
    }
  }

  const ranked = rankFiveYearClubs(
    Array.from(bestByTarget.entries()).map(([clubId, v]) => ({ clubId, totalPoints: v.totalPoints })),
  );

  return ranked.map((r) => ({
    clubId: r.clubId,
    totalPoints: r.totalPoints,
    rank: r.rank,
    sourceRowId: bestByTarget.get(r.clubId)!.sourceRowId,
  }));
}
