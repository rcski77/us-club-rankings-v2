import ExcelJS from "exceljs";

// Parses a Sportwrench/Otto "Teams" export (.xlsx). Header names are matched
// case-insensitively; unknown columns (director contact info, player counts, ...) are
// ignored. Problems are returned, not thrown -- see docs/adr/0001-event-seeding-report.md.

export type TeamListRow = {
  /** 1-based spreadsheet row number, for error messages. */
  rowNumber: number;
  teamName: string;
  divisionName: string;
  /** Raw code as given ("B18SHARK1SO"). */
  code: string;
  clubName: string;
  city: string;
  state: string;
  gender: string;
};

export type TeamListParseResult = {
  rows: TeamListRow[];
  fileError: string | null;
  /** Codes that appear on more than one row (same division or not). */
  duplicateCodes: string[];
};

const HEADERS = {
  division: ["division name", "division"],
  code: ["usav code", "team code", "code"],
  team: ["team name", "team"],
  club: ["club name", "club"],
  city: ["city"],
  state: ["state"],
  gender: ["gender"],
} as const;

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join("").trim();
    }
    if ("result" in value && value.result !== undefined) return String(value.result).trim();
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value).trim();
}

export async function parseTeamListXlsx(data: ArrayBuffer | Buffer): Promise<TeamListParseResult> {
  const empty = (fileError: string): TeamListParseResult => ({ rows: [], fileError, duplicateCodes: [] });

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types want its own Buffer alias; the runtime accepts any Buffer/ArrayBuffer.
    await workbook.xlsx.load(data as ExcelJS.Buffer);
  } catch {
    return empty("Could not read the file as an .xlsx workbook.");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return empty("The workbook has no sheets.");

  const headerRow = sheet.getRow(1);
  const columnByHeader = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const key = cellText(cell.value).toLowerCase();
    if (key && !columnByHeader.has(key)) columnByHeader.set(key, colNumber);
  });

  const find = (names: readonly string[]): number | undefined => {
    for (const n of names) {
      const col = columnByHeader.get(n);
      if (col !== undefined) return col;
    }
    return undefined;
  };

  const divisionCol = find(HEADERS.division);
  const codeCol = find(HEADERS.code);
  const missing: string[] = [];
  if (divisionCol === undefined) missing.push('"Division name"');
  if (codeCol === undefined) missing.push('"USAV code"');
  if (divisionCol === undefined || codeCol === undefined) {
    return empty(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  }

  const teamCol = find(HEADERS.team);
  const clubCol = find(HEADERS.club);
  const cityCol = find(HEADERS.city);
  const stateCol = find(HEADERS.state);
  const genderCol = find(HEADERS.gender);
  const get = (row: ExcelJS.Row, col: number | undefined) => (col === undefined ? "" : cellText(row.getCell(col).value));

  const rows: TeamListRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = get(row, codeCol);
    const divisionName = get(row, divisionCol);
    const teamName = get(row, teamCol);
    if (!code && !divisionName && !teamName) continue; // blank row
    rows.push({
      rowNumber: r,
      teamName,
      divisionName: divisionName || "(no division)",
      code,
      clubName: get(row, clubCol),
      city: get(row, cityCol),
      state: get(row, stateCol),
      gender: get(row, genderCol),
    });
  }

  if (rows.length === 0) return empty("The sheet has a header row but no team rows.");

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.code) continue;
    const key = row.code.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateCodes = [...counts.entries()].filter(([, n]) => n > 1).map(([code]) => code);

  return { rows, fileError: null, duplicateCodes };
}
