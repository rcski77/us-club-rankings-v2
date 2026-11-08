// Plain-JSON shapes shared by the server-side report builder and the client report UI.
// No server imports here so client components can use it.

export type SeedingFlag =
  | "UNMATCHED"
  | "LINEAGE_MATCH"
  | "NO_RATING"
  | "PRIOR_SEASON_RATING"
  | "THIN_DATA"
  | "ENGINE_DISAGREEMENT"
  | "DUPLICATE_CODE"
  | "AGE_MISMATCH"
  | "NEAR_TIE";

export const FLAG_LABEL: Record<SeedingFlag, string> = {
  UNMATCHED: "Unmatched",
  LINEAGE_MATCH: "Lineage match",
  NO_RATING: "No rating",
  PRIOR_SEASON_RATING: "Last yr's feeder team (roster may differ)",
  THIN_DATA: "Thin data",
  ENGINE_DISAGREEMENT: "Engines disagree",
  DUPLICATE_CODE: "Duplicate code",
  AGE_MISMATCH: "Plays up/down",
  NEAR_TIE: "Near tie",
};

export type SeedingTeam = {
  rowNumber: number;
  /** As given in the uploaded file. */
  fileTeamName: string;
  fileClubName: string;
  city: string;
  state: string;
  code: string;
  matchStatus: "MATCHED" | "LINEAGE" | "UNMATCHED";
  /** Our record, when matched. */
  teamId: string | null;
  teamName: string | null;
  clubName: string | null;
  /** Age group the team is enrolled/rated in (may differ from the division's age). */
  ageGroup: number | null;
  ratingSource: "current" | "prior" | "none";
  /** For a prior-season rating: the feeder team it came from (last year's team one age
   * down in the same club program), e.g. "WPVC Boys 12 Navy (12s, 2025-2026)". */
  ratingFromTeam: string | null;
  colleyRank: number | null;
  eloRank: number | null;
  masseyRank: number | null;
  /** Average of the engines' partition ranks; null when unrated. */
  avgRank: number | null;
  npsRank: number | null;
  npsPoints: number | null;
  matchesPlayed: number;
  distinctOpponents: number;
  /** ISO date of the team's last match before the event, if any. */
  lastMatchDate: string | null;
  flags: SeedingFlag[];
};

export type SeedingDivisionReport = {
  name: string;
  teams: SeedingTeam[];
};

export type SeedingReport = {
  eventName: string;
  seasonLabel: string;
  /** ISO date; match evidence is limited to matches before this. */
  evidenceCutoff: string | null;
  totalRows: number;
  matched: number;
  lineageMatched: number;
  unmatched: number;
  divisions: SeedingDivisionReport[];
};
