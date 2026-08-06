import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { computeFiveYearClubScore, rankFiveYearClubs, FIVE_YEAR_WEIGHTS } from "./fiveYearClubRanking";

const ALGORITHM_VERSION = "phase-5yr-v1";

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
