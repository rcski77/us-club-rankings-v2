import { prisma } from "@/lib/prisma";
import { getResolvedFiveYearRanking } from "./computeFiveYearClubRanking";

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

  // Resolved per endYear (not a single findMany across all of them): a club merged
  // into another (Club.mergedIntoClubId) is retired outright, its history folded onto
  // the surviving club (see mergeClubsIntoTarget) -- getResolvedFiveYearRanking
  // applies that fold, plus the ranking-group redirect, and re-derives each endYear's
  // rank over the resulting set rather than trusting the stored `rank` column, which
  // was computed against a wider set that included the now-excluded club as its own
  // separate entry.
  const resolvedByYear = await Promise.all(endYears.map((y) => getResolvedFiveYearRanking(y)));

  const byClub = new Map<string, FiveYearRankingHistoryRow>();
  const clubIds = new Set<string>();
  resolvedByYear.forEach((resolved, i) => {
    const endYear = endYears[i];
    for (const r of resolved) {
      clubIds.add(r.clubId);
      const entry = byClub.get(r.clubId) ?? {
        clubId: r.clubId,
        clubName: "",
        clubCode: null,
        state: null,
        byYear: {},
      };
      entry.byYear[endYear] = { rank: r.rank, totalPoints: r.totalPoints };
      byClub.set(r.clubId, entry);
    }
  });

  const clubs = await prisma.club.findMany({
    where: { id: { in: [...clubIds] } },
    select: { id: true, name: true, externalCode: true, state: true },
  });
  for (const c of clubs) {
    const entry = byClub.get(c.id);
    if (!entry) continue;
    entry.clubName = c.name;
    entry.clubCode = c.externalCode;
    entry.state = c.state;
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
