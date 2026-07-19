import { parse } from "csv-parse/sync";

// AES results CSV columns (confirmed from a real sample, see docs/domain-notes.md):
// ageGroupLabel, rank, "Team Name (RegionCode) (seedNumber)", teamCode
// One file covers a whole event's age groups/tiers at once. Large events are split
// into multiple sequential files ("_part1", "_part2", ...) purely because the
// source scraper errors past ~300 lines.

export type RawAesCsvRow = {
  rowNumber: number; // 1-based, within this file
  ageGroupLabel: string;
  rank: string;
  teamNameField: string;
  teamCode: string;
};

export type AesCsvParseResult = {
  rows: RawAesCsvRow[];
  fileError: string | null;
};

type CanonicalField = "ageGroupLabel" | "rank" | "teamNameField" | "teamCode";

// NOTE: built from the documented column format, not yet verified against a real
// exported file -- see docs/plan.md Phase 2 plan's "get a real AES sample" note.
// Header-based parsing is tried first; strict positional 4-column parsing (in the
// documented order) is the fallback if no header row matches these aliases.
const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  ageGroupLabel: ["agegrouplabel", "age group", "agegroup", "division"],
  rank: ["rank", "finish", "place"],
  teamNameField: ["teamname", "team name", "team"],
  teamCode: ["teamcode", "team code", "code"],
};

function matchHeaderColumns(headerKeys: string[]): Record<CanonicalField, string> | null {
  const normalized = headerKeys.map((h) => h.trim().toLowerCase());
  const mapping = {} as Record<CanonicalField, string>;
  for (const field of Object.keys(HEADER_ALIASES) as CanonicalField[]) {
    const idx = normalized.findIndex((h) => HEADER_ALIASES[field].includes(h));
    if (idx === -1) return null;
    mapping[field] = headerKeys[idx];
  }
  return mapping;
}

export function parseAesCsv(rawContent: string): AesCsvParseResult {
  const trimmed = rawContent.trim();
  if (!trimmed) return { rows: [], fileError: "File is empty." };

  const headerResult = tryParseWithHeader(trimmed);
  if (headerResult) return headerResult;

  return tryParsePositional(trimmed);
}

function tryParseWithHeader(trimmed: string): AesCsvParseResult | null {
  try {
    const records = parse(trimmed, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    if (records.length === 0) return null;
    const mapping = matchHeaderColumns(Object.keys(records[0]));
    if (!mapping) return null;

    return {
      fileError: null,
      rows: records.map((r, i) => ({
        rowNumber: i + 1,
        ageGroupLabel: r[mapping.ageGroupLabel] ?? "",
        rank: r[mapping.rank] ?? "",
        teamNameField: r[mapping.teamNameField] ?? "",
        teamCode: r[mapping.teamCode] ?? "",
      })),
    };
  } catch {
    return null;
  }
}

function tryParsePositional(trimmed: string): AesCsvParseResult {
  try {
    const records = parse(trimmed, {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as string[][];

    if (records.length === 0) return { rows: [], fileError: "No data rows found." };

    const badRow = records.find((r) => r.length !== 4);
    if (badRow) {
      return {
        rows: [],
        fileError: `Expected 4 columns per row (ageGroupLabel, rank, team name, teamCode), found a row with ${badRow.length}.`,
      };
    }

    return {
      fileError: null,
      rows: records.map((r, i) => ({
        rowNumber: i + 1,
        ageGroupLabel: r[0],
        rank: r[1],
        teamNameField: r[2],
        teamCode: r[3],
      })),
    };
  } catch (err) {
    return {
      rows: [],
      fileError: `Could not parse CSV: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
