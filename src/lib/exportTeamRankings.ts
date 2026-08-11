import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getLatestPowerRatings, buildPowerRows, averagePowerRank, sortRows, assignRanksWithTies } from "@/lib/rating/powerRankings";

// Generates a "Team Rankings" workbook for a season -- one sheet per age group, each
// listing that age group's top 100 Combined-ranked teams (50% NPS rank + 50% Power
// Rankings' own Avg Rank -- same blend as the admin/public Combined Rankings tab, see
// powerRankings.ts's computeCombinedRankByTeam), same rank cap used to define
// club-ranking qualification (see exportClubRankings.ts's own PUBLISHED_RANK_LIMIT).

const PUBLISHED_RANK_LIMIT = 100;
const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];

export type TeamRankingsExportResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: string };

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" }, // slate-800
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

type TeamInfo = { id: string; name: string; club: { name: string; state: string | null } | null };
type CombinedRow = { team: TeamInfo; npsRank: number | undefined; powerAvgRank: number | undefined };

function combinedScore(r: CombinedRow): number | undefined {
  const parts = [r.npsRank, r.powerAvgRank].filter((v): v is number => v !== undefined);
  if (parts.length === 0) return undefined;
  return parts.reduce((sum, v) => sum + v, 0) / parts.length;
}

/** Same union-of-both-rankings + 50/50 blend as CombineRankingTable in
 * team-rankings/page.tsx, but also carries team/club display info through (the
 * shared computeCombinedRankByTeam in powerRankings.ts only returns a teamId->rank
 * map, which isn't enough to render a spreadsheet row). */
async function buildCombinedRows(seasonId: string, ageGroup: number) {
  const [npsResults, powerData] = await Promise.all([
    prisma.rankingResult.findMany({
      where: { seasonId, ageGroup },
      select: { teamId: true, rank: true, team: { select: { id: true, name: true, club: { select: { name: true, state: true } } } } },
    }),
    getLatestPowerRatings(seasonId, ageGroup),
  ]);
  const powerRows = buildPowerRows(powerData);

  const npsRankByTeam = new Map(npsResults.map((r) => [r.teamId, r.rank]));
  const powerAvgRankByTeam = new Map(powerRows.map((r) => [r.team.id, averagePowerRank(r)]));

  const teamById = new Map<string, TeamInfo>();
  for (const r of npsResults) teamById.set(r.teamId, r.team);
  for (const r of powerRows) teamById.set(r.team.id, r.team);

  const rows: CombinedRow[] = Array.from(teamById.entries()).map(([teamId, team]) => ({
    team,
    npsRank: npsRankByTeam.get(teamId),
    powerAvgRank: powerAvgRankByTeam.get(teamId),
  }));

  const rankByTeamId = assignRanksWithTies(sortRows(rows, combinedScore, "asc"), combinedScore, (r) => r.team.id);
  return sortRows(rows, combinedScore, "asc")
    .filter((r) => (rankByTeamId.get(r.team.id) ?? Infinity) <= PUBLISHED_RANK_LIMIT)
    .map((r) => ({ ...r, rank: rankByTeamId.get(r.team.id) }));
}

export async function buildTeamRankingsWorkbook(seasonId: string): Promise<TeamRankingsExportResult> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return { ok: false, reason: "Season not found." };

  const rowsByAgeGroup = await Promise.all(AGE_GROUPS.map((ageGroup) => buildCombinedRows(seasonId, ageGroup)));
  if (rowsByAgeGroup.every((rows) => rows.length === 0)) {
    return { ok: false, reason: `No team rankings computed for ${season.label} yet.` };
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "US Club Rankings";
  workbook.created = new Date();

  AGE_GROUPS.forEach((ageGroup, i) => {
    const rows = rowsByAgeGroup[i];
    if (rows.length === 0) return;

    const sheet = workbook.addWorksheet(`${ageGroup}u`);
    sheet.addRow([`${season.label} ${ageGroup}U National Team Rankings — Combined`]).font = { bold: true, size: 14 };
    sheet.addRow([
      `Combined rank blends 50% NPS rank and 50% Power Rankings' Avg Rank (Colley/Elo/Massey average). Top ${PUBLISHED_RANK_LIMIT} shown.`,
    ]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(["Rank", "Team", "Club", "State", "Combined Score", "NPS Rank", "Power Avg Rank"]);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
    });

    for (const r of rows) {
      const row = sheet.addRow([
        r.rank ?? null,
        r.team.name,
        r.team.club?.name ?? "",
        r.team.club?.state ?? "",
        combinedScore(r) ?? null,
        r.npsRank ?? null,
        r.powerAvgRank ?? null,
      ]);
      row.getCell(5).numFmt = "0.0";
      row.getCell(7).numFmt = "0.0";
    }

    sheet.columns = [
      { width: 8 },
      { width: 32 },
      { width: 28 },
      { width: 8 },
      { width: 16 },
      { width: 12 },
      { width: 16 },
    ];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { ok: true, buffer: Buffer.from(buffer) };
}
