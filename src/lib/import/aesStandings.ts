import { fetchAes } from "./aesFetch";
import type { RawAesCsvRow } from "./aesCsv";

const AES_API_BASE = "https://results.advancedeventsystems.com";

export type AesDivisionRef = { divisionId: number; name: string };
export type AesEventInfo = { name: string; divisions: AesDivisionRef[] };

type ApiDivision = { DivisionId: number; Name: string };
type ApiEventResponse = { Name?: string; Divisions?: ApiDivision[] };

export async function fetchAesEventInfo(aesEventId: string): Promise<AesEventInfo> {
  const res = await fetchAes(`${AES_API_BASE}/api/event/${encodeURIComponent(aesEventId)}`);
  if (!res.ok) {
    throw new Error(`AES event lookup failed for "${aesEventId}": ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as ApiEventResponse;
  return {
    name: data.Name ?? "",
    divisions: (data.Divisions ?? []).map((d) => ({ divisionId: d.DivisionId, name: d.Name })),
  };
}

type ApiStandingTeam = {
  TeamName?: string;
  TeamCode?: string;
  FinishRank?: number;
  Division?: { Name?: string };
  Club?: { ClubId?: number; Name?: string };
};
type ApiStandingsResponse = { value?: ApiStandingTeam[] };

export async function fetchAesDivisionStandings(
  aesEventId: string,
  divisionId: number,
): Promise<ApiStandingTeam[]> {
  const url =
    `${AES_API_BASE}/odata/${encodeURIComponent(aesEventId)}/standings(dId=${divisionId},cId=null,tIds=[])` +
    `?$orderby=OverallRank,FinishRank,TeamName,TeamCode`;
  const res = await fetchAes(url);
  if (!res.ok) {
    throw new Error(
      `AES standings lookup failed for event "${aesEventId}" division ${divisionId}: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as ApiStandingsResponse;
  return data.value ?? [];
}

// AES's standings endpoint carries the club's real display name directly (Club.Name)
// -- unlike the CSV export, which only ever gives a team-code + free-text team name,
// forcing resolve.ts's admin-typed-or-heuristic-guessed overrideClubName flow. When
// fetching, prefer AES's own name over guessing one from the team name text.
export type AesStandingRow = RawAesCsvRow & { clubName: string | null };

export type FetchAesStandingsResult = {
  rows: AesStandingRow[];
  raw: unknown;
  eventName: string;
  skippedCount: number; // teams missing a TeamCode -- can't resolve, so not turned into rows
};

/**
 * Fetches an AES event's final standings across every division and maps them into
 * the same row shape aesCsv.ts's parser produces (plus the real club name AES's JSON
 * API gives us, which the CSV path doesn't have), so the rest of the import pipeline
 * (resolve.ts, commit.ts, the review UI) can consume them unchanged.
 */
export async function fetchAesStandingsRows(aesEventId: string): Promise<FetchAesStandingsResult> {
  const eventInfo = await fetchAesEventInfo(aesEventId);

  const rawByDivision: Record<number, ApiStandingTeam[]> = {};
  const rows: AesStandingRow[] = [];
  let skippedCount = 0;
  let rowNumber = 0;

  for (const division of eventInfo.divisions) {
    const teams = await fetchAesDivisionStandings(aesEventId, division.divisionId);
    rawByDivision[division.divisionId] = teams;

    for (const team of teams) {
      if (!team.TeamCode || team.FinishRank == null) {
        skippedCount += 1;
        continue;
      }
      rowNumber += 1;
      rows.push({
        rowNumber,
        ageGroupLabel: team.Division?.Name ?? division.name,
        rank: String(team.FinishRank),
        teamNameField: team.TeamName ?? "",
        teamCode: team.TeamCode,
        clubName: team.Club?.Name?.trim() || null,
      });
    }
  }

  return {
    rows,
    raw: { event: eventInfo, divisions: rawByDivision },
    eventName: eventInfo.name,
    skippedCount,
  };
}
