import { sortForSeeding, type SeedSort } from "./bands";
import { FLAG_LABEL, type SeedingDivisionReport } from "./types";

// Client-safe CSV of the seeding tables (browser print covers the paper version).

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SEEDING_CSV_HEADER = [
  "Division",
  "Suggested seed",
  "Team code",
  "Team (file)",
  "Club (file)",
  "Match",
  "Our team name",
  "Avg power rank",
  "Colley rank",
  "Elo rank",
  "Massey rank",
  "NPS rank",
  "NPS points",
  "Matches before event",
  "Distinct opponents",
  "Last match",
  "Flags",
];

export function buildSeedingCsv(divisions: SeedingDivisionReport[], sort: SeedSort): string {
  const lines = [SEEDING_CSV_HEADER.map(csvCell).join(",")];
  for (const division of divisions) {
    sortForSeeding(division.teams, sort).forEach((t, i) => {
      lines.push(
        [
          division.name,
          i + 1,
          t.code,
          t.fileTeamName,
          t.fileClubName,
          t.matchStatus,
          t.teamName,
          t.avgRank === null ? null : Math.round(t.avgRank * 10) / 10,
          t.colleyRank,
          t.eloRank,
          t.masseyRank,
          t.npsRank,
          t.npsPoints,
          t.matchesPlayed,
          t.distinctOpponents,
          t.lastMatchDate ? t.lastMatchDate.slice(0, 10) : null,
          t.flags.map((f) => FLAG_LABEL[f]).join("; "),
        ]
          .map(csvCell)
          .join(","),
      );
    });
  }
  return lines.join("\r\n") + "\r\n";
}
