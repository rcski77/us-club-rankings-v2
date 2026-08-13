import { prisma } from "@/lib/prisma";

export type FiveYearRankingHistoryRow = {
  clubId: string;
  clubName: string;
  clubCode: string | null;
  state: string | null;
  byYear: Record<number, { rank: number; totalPoints: number } | undefined>;
};

export type FiveYearRankingHistory = {
  endYears: number[]; // ascending, oldest to newest -- one column per computed window
  rows: FiveYearRankingHistoryRow[]; // sorted by rank within the most recent window
};

/**
 * Pivots every computed ClubFiveYearRankingResult (one row per club per endYear) into
 * one row per club with a rank+points cell per endYear column -- the app's analog of
 * the legacy workbook's "5 Year to Publish" sheet, which showed a club's rank *within
 * that year's own 5-year-window aggregate*, not a single-year rank (confirmed: that
 * sheet's "2025 Points" column matched this app's own endYear=2025 total exactly).
 * Grows a column at a time as staff syncs/recomputes new endYears -- no separate
 * import needed, this is a pure read over data the 5-Year Aggregate page already
 * writes.
 */
export async function getFiveYearRankingHistory(): Promise<FiveYearRankingHistory> {
  const endYearRows = await prisma.clubFiveYearRankingResult.findMany({
    distinct: ["endYear"],
    select: { endYear: true },
    orderBy: { endYear: "asc" },
  });
  const endYears = endYearRows.map((r) => r.endYear);
  if (endYears.length === 0) return { endYears: [], rows: [] };

  const results = await prisma.clubFiveYearRankingResult.findMany({
    // A club merged into another (Club.mergedIntoClubId) is retired outright -- its
    // history was folded into the surviving club (see mergeClubsIntoTarget), so it
    // shouldn't still show up as its own row here, including in already-frozen
    // legacy-imported windows that predate the merge and can't be recomputed.
    where: { endYear: { in: endYears }, club: { mergedIntoClubId: null } },
    select: {
      endYear: true,
      rank: true,
      totalPoints: true,
      club: { select: { id: true, name: true, externalCode: true, state: true } },
    },
  });

  const byClub = new Map<string, FiveYearRankingHistoryRow>();
  for (const r of results) {
    const entry = byClub.get(r.club.id) ?? {
      clubId: r.club.id,
      clubName: r.club.name,
      clubCode: r.club.externalCode,
      state: r.club.state,
      byYear: {},
    };
    entry.byYear[r.endYear] = { rank: r.rank, totalPoints: r.totalPoints };
    byClub.set(r.club.id, entry);
  }

  // Sorted by rank within the most recent window -- same convention the legacy sheet
  // itself used (verified: its row order matches this app's own endYear=2025 table
  // exactly), with any club missing from the latest window pushed to the bottom
  // rather than sorted arbitrarily.
  const latestYear = endYears[endYears.length - 1];
  const rows = Array.from(byClub.values()).sort((a, b) => {
    const ar = a.byYear[latestYear]?.rank ?? Number.POSITIVE_INFINITY;
    const br = b.byYear[latestYear]?.rank ?? Number.POSITIVE_INFINITY;
    return ar - br;
  });

  return { endYears, rows };
}
