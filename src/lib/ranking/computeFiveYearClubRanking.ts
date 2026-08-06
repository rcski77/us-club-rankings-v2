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
  const clubIds = [...new Set(scores.map((s) => s.clubId))];
  const clubs = clubIds.length
    ? await prisma.club.findMany({
        where: { id: { in: clubIds } },
        select: { id: true, rankingGroupPrimaryClubId: true },
      })
    : [];
  const rankingClubId = new Map(clubs.map((c) => [c.id, c.rankingGroupPrimaryClubId ?? c.id]));

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
