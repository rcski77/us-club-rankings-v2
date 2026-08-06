import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { computeFiveYearClubScore, rankFiveYearClubs, FIVE_YEAR_WEIGHTS } from "./fiveYearClubRanking";
import type { ClubRankingSource } from "@/generated/prisma/enums";

const ALGORITHM_VERSION = "phase-5yr-v1";

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
 */
export async function computeFiveYearClubRankingForYear(endYear: number) {
  const years = Array.from({ length: FIVE_YEAR_WEIGHTS.length }, (_, i) => endYear - (FIVE_YEAR_WEIGHTS.length - 1 - i));

  const scores = await prisma.clubAnnualScore.findMany({
    where: { year: { in: years } },
    select: { clubId: true, year: true, totalPoints: true },
  });

  const pointsByClub = new Map<string, Partial<Record<number, number>>>();
  for (const s of scores) {
    const entry = pointsByClub.get(s.clubId) ?? {};
    entry[s.year] = s.totalPoints;
    pointsByClub.set(s.clubId, entry);
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
}
