import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { FIVE_YEAR_WEIGHTS } from "@/lib/ranking/fiveYearClubRanking";

// Generates the "N Rankings for Publish.xlsx" workbook staff have historically
// hand-built each year (two sheets: "5 Year Ranking" and "1 Year Ranking") straight
// from this app's own data, so publishing no longer means manually retyping a legacy
// spreadsheet. Column shape on both sheets is the same (year-by-year rank/points for
// the club's trailing 5 calendar years, Club, State) but the two sheets deliberately
// read different underlying numbers per year, matching the legacy hand-built report:
// the "5 Year Ranking" sheet's year columns are each that year's own already-published
// 5-year-consolidated rank/score (ClubFiveYearRankingResult, one endYear per column),
// while the "1 Year Ranking" sheet's year columns are that year's single-season
// rank/score (ClubAnnualScore). See docs/domain-notes.md for the ranking methodology
// this reproduces in prose form on each sheet.

const PUBLISHED_RANK_LIMIT = 100; // same cap as /rankings/club-rankings/five-year (public)

type YearCell = { points: number; rank: number | null };

export type ClubRankingsExportResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: string };

export async function buildClubRankingsWorkbook(endYear: number): Promise<ClubRankingsExportResult> {
  const years = Array.from({ length: 5 }, (_, i) => endYear - (4 - i)); // oldest -> newest

  const fiveYearResults = await prisma.clubFiveYearRankingResult.findMany({
    // Exclude clubs merged into another club (Club.mergedIntoClubId) -- their history
    // now belongs to the surviving club, including in frozen legacy-imported windows
    // that predate the merge.
    where: { endYear, rank: { lte: PUBLISHED_RANK_LIMIT }, club: { mergedIntoClubId: null } },
    include: { club: true },
    orderBy: { rank: "asc" },
  });
  if (fiveYearResults.length === 0) {
    return {
      ok: false,
      reason: `No 5-year ranking computed for ${endYear - 4}–${endYear} yet — run "Recompute" on the 5-Year Aggregate page first.`,
    };
  }

  // --- Per-year rank/points, collapsed onto each club's ranking-group primary club (or
  // its merge target, if it's since been merged away) -- same "score redirects to the
  // surviving club, higher of the two wins on a shared year" rule
  // computeFiveYearClubRankingForYear applies for the 5-year *total*; applied here
  // per-cell so a merged/grouped club's per-year Rank and Points always come from the
  // same underlying row (never rank from one club, points from another). mergedIntoClubId
  // takes priority over rankingGroupPrimaryClubId (a merged-away club is retired
  // outright), and matters here specifically because mergeClubsIntoTarget leaves a
  // colliding year's losing ClubAnnualScore row in place on the now-inactive source
  // club rather than deleting it -- without this redirect that stray row would still
  // surface as its own line on the export. legacyRank is trusted as-is (see its schema
  // comment: populated for both legacy-imported and this-app-computed years, not just
  // legacy ones) rather than re-derived, since it's exactly the "this year's own
  // published rank" value both sheets need and computeFiveYearClubRankingForYear never
  // recomputes it itself.
  const annualScores = await prisma.clubAnnualScore.findMany({
    where: { year: { in: years } },
    select: { clubId: true, year: true, totalPoints: true, legacyRank: true },
  });
  const scoredClubIds = [...new Set(annualScores.map((s) => s.clubId))];
  const scoredClubs = scoredClubIds.length
    ? await prisma.club.findMany({
        where: { id: { in: scoredClubIds } },
        select: { id: true, mergedIntoClubId: true, rankingGroupPrimaryClubId: true },
      })
    : [];
  const rankingClubId = new Map(
    scoredClubs.map((c) => [c.id, c.mergedIntoClubId ?? c.rankingGroupPrimaryClubId ?? c.id]),
  );

  const perYearByClub = new Map<string, Map<number, YearCell>>();
  for (const s of annualScores) {
    const targetClubId = rankingClubId.get(s.clubId) ?? s.clubId;
    const byYear = perYearByClub.get(targetClubId) ?? new Map<number, YearCell>();
    const existing = byYear.get(s.year);
    // On points ties (common for a merge target's own legacy row vs. the merged-in
    // club's row -- the source workbook recorded the same consolidated total on both,
    // see rankings/clubs/[clubId]/page.tsx's own note that legacyRank wasn't recorded
    // for every year) prefer whichever row actually has a rank, so a real published
    // rank isn't dropped just because it happened to lose the race to be read first.
    const isBetter =
      !existing ||
      s.totalPoints > existing.points ||
      (s.totalPoints === existing.points && existing.rank === null && s.legacyRank !== null);
    if (isBetter) {
      byYear.set(s.year, { points: s.totalPoints, rank: s.legacyRank });
    }
    perYearByClub.set(targetClubId, byYear);
  }

  // Club display info (name/state) -- fetched for the union of every target clubId
  // we'll display a row for (5-year results + any club with an endYear score), since a
  // ranking-group's primary club may itself have no ClubAnnualScore row of its own
  // (only its members do) and so wouldn't otherwise appear in `scoredClubs` above.
  const displayClubIds = new Set<string>(fiveYearResults.map((r) => r.clubId));
  for (const [clubId, byYear] of perYearByClub) {
    if (byYear.has(endYear)) displayClubIds.add(clubId);
  }
  const displayClubs = await prisma.club.findMany({
    where: { id: { in: [...displayClubIds] } },
    select: { id: true, name: true, state: true },
  });
  const clubById = new Map(displayClubs.map((c) => [c.id, c]));

  // --- Per-year 5-year-consolidated rank/points, for the "5 Year Ranking" sheet's
  // year columns -- each column is that year's own already-computed
  // ClubFiveYearRankingResult (endYear = that column's year), not that year's 1-year
  // score. computeFiveYearClubRankingForYear already writes these keyed to a ranking
  // group's primary club, so no merge-collapse is needed here (unlike perYearByClub
  // above, which reads raw per-club ClubAnnualScore rows).
  const fiveYearResultsAllYears = await prisma.clubFiveYearRankingResult.findMany({
    where: { endYear: { in: years } },
    select: { clubId: true, endYear: true, totalPoints: true, rank: true },
  });
  const fiveYearByClub = new Map<string, Map<number, YearCell>>();
  for (const r of fiveYearResultsAllYears) {
    const byYear = fiveYearByClub.get(r.clubId) ?? new Map<number, YearCell>();
    byYear.set(r.endYear, { points: r.totalPoints, rank: r.rank });
    fiveYearByClub.set(r.clubId, byYear);
  }

  // --- Tiering (qualified / under-qualified) for the 1-Year sheet, when derivable ---
  // Only possible when endYear's ClubAnnualScore rows came from this app's own
  // computed ClubRankingResult (source "COMPUTED_NPS"/"COMPUTED_COMBINED") -- a
  // legacy-imported year has no isQualified concept anywhere in this app's data.
  const endYearSourceRows = await prisma.clubAnnualScore.findMany({
    where: { year: endYear },
    select: { source: true },
    distinct: ["source"],
  });
  let qualifiedByClubId: Map<string, boolean> | null = null;
  if (endYearSourceRows.length === 1 && endYearSourceRows[0].source.startsWith("COMPUTED_")) {
    const rankingSource = endYearSourceRows[0].source === "COMPUTED_NPS" ? "NPS" : "COMBINED";
    const seasons = await prisma.season.findMany({ select: { id: true, endDate: true } });
    const seasonIds = seasons.filter((s) => s.endDate.getFullYear() === endYear).map((s) => s.id);
    if (seasonIds.length > 0) {
      const rankingResults = await prisma.clubRankingResult.findMany({
        where: { seasonId: { in: seasonIds }, source: rankingSource },
        select: { clubId: true, isQualified: true },
      });
      qualifiedByClubId = new Map(rankingResults.map((r) => [r.clubId, r.isQualified]));
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "US Club Rankings";
  workbook.created = new Date();

  addFiveYearSheet(workbook, endYear, years, fiveYearResults, fiveYearByClub);
  addOneYearSheet(workbook, endYear, years, perYearByClub, clubById, qualifiedByClubId);

  const buffer = await workbook.xlsx.writeBuffer();
  return { ok: true, buffer: Buffer.from(buffer) };
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" }, // slate-800
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

function addMethodologyBlock(sheet: ExcelJS.Worksheet, title: string, lines: string[]) {
  sheet.addRow([title]).font = { bold: true, size: 14 };
  for (const line of lines) {
    sheet.addRow([line]);
  }
  sheet.addRow([]);
}

type FiveYearResultRow = {
  clubId: string;
  rank: number;
  club: { name: string; state: string | null };
};

function addFiveYearSheet(
  workbook: ExcelJS.Workbook,
  endYear: number,
  years: number[],
  fiveYearResults: FiveYearResultRow[],
  fiveYearByClub: Map<string, Map<number, YearCell>>,
) {
  const sheet = workbook.addWorksheet("5 Year Ranking");

  addMethodologyBlock(sheet, `${endYear} National Volleyball Club Ranking – 5 Year Consolidated`, [
    `Each club's 5-year score is a recency-weighted blend of its single-season club score in each of the trailing 5 calendar years (${years.join(", ")}):`,
    years.map((y, i) => `${y}: ${FIVE_YEAR_WEIGHTS[i] * 100}%`).join("   "),
    "A year with no score for a club contributes 0, not a renormalized share of the remaining weight.",
    `Top ${PUBLISHED_RANK_LIMIT} shown.`,
  ]);

  const headerRow = sheet.addRow([
    ...years.map((y) => `${y} Ranking`),
    "Club",
    "State",
    ...years.map((y) => `${y} Points`),
  ]);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const r of fiveYearResults) {
    const byYear = fiveYearByClub.get(r.clubId);
    const row = sheet.addRow([
      ...years.map((y) => byYear?.get(y)?.rank ?? null),
      r.club.name,
      r.club.state ?? "",
      ...years.map((y) => byYear?.get(y)?.points ?? null),
    ]);
    for (let i = 0; i < years.length; i++) {
      row.getCell(years.length + 2 + 1 + i).numFmt = "0.00";
    }
  }

  sizeColumns(sheet, years.length);
}

function addOneYearSheet(
  workbook: ExcelJS.Workbook,
  endYear: number,
  years: number[],
  perYearByClub: Map<string, Map<number, YearCell>>,
  clubById: Map<string, { id: string; name: string; state: string | null }>,
  qualifiedByClubId: Map<string, boolean> | null,
) {
  const sheet = workbook.addWorksheet("1 Year Ranking");

  addMethodologyBlock(sheet, `${endYear} National Volleyball Club Ranking – 1 Year`, [
    `A club qualifies for the National Club Ranking if it has at least 3 teams in different age groups ranked in the top 100 of the ${endYear} National Rankings. Each qualifying age group's rank converts to points (1st = 100, ..., 100th = 1), and the club's best 5 of its 6 age groups are summed for its ${endYear} score.`,
    "Clubs with fewer than 3 qualifying age groups are still shown below, ranked after every qualifying club.",
    `Trailing-4-year rank/points are shown for reference only — sorting is by ${endYear} rank.`,
  ]);

  const rows = [...perYearByClub.entries()]
    .map(([clubId, byYear]) => ({ clubId, current: byYear.get(endYear), byYear }))
    .filter((r): r is { clubId: string; current: YearCell; byYear: Map<number, YearCell> } => r.current !== undefined)
    .sort((a, b) => (a.current.rank ?? Infinity) - (b.current.rank ?? Infinity))
    .slice(0, PUBLISHED_RANK_LIMIT);

  const headerRow = sheet.addRow([
    ...years.map((y) => `${y} Ranking`),
    "Club",
    "State",
    ...years.map((y) => `${y} Points`),
  ]);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  let dividerShown = qualifiedByClubId === null; // no tiering info -> never show the divider
  for (const r of rows) {
    const isQualified = qualifiedByClubId?.get(r.clubId) ?? true;
    if (!dividerShown && !isQualified) {
      const divider = sheet.addRow(["Clubs below only had 2 teams in the top 100 Rankings"]);
      divider.font = { italic: true };
      dividerShown = true;
    }
    const club = clubById.get(r.clubId);
    const row = sheet.addRow([
      ...years.map((y) => r.byYear.get(y)?.rank ?? null),
      club?.name ?? "(unknown club)",
      club?.state ?? "",
      ...years.map((y) => r.byYear.get(y)?.points ?? null),
    ]);
    for (let i = 0; i < years.length; i++) {
      row.getCell(years.length + 2 + 1 + i).numFmt = "0.00";
    }
  }

  sizeColumns(sheet, years.length);
}

function sizeColumns(sheet: ExcelJS.Worksheet, yearCount: number) {
  const rankCols = Array.from({ length: yearCount }, () => ({ width: 10 }));
  const pointCols = Array.from({ length: yearCount }, () => ({ width: 10 }));
  sheet.columns = [...rankCols, { width: 32 }, { width: 8 }, ...pointCols];
}
