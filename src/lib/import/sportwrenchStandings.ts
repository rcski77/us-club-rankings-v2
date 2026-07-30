import { fetchSportwrench } from "./sportwrenchFetch";
import type { RawAesCsvRow } from "./aesCsv";

const SW_API_BASE = "https://events.sportwrench.com/api/esw";

export type SportwrenchDivisionRef = { divisionId: number; name: string };
export type SportwrenchEventInfo = { name: string; divisions: SportwrenchDivisionRef[] };

type ApiEventResponse = { long_name?: string; name?: string };
type ApiDivision = { division_id: number; name: string };

export async function fetchSportwrenchEventInfo(eventId: string): Promise<SportwrenchEventInfo> {
  const res = await fetchSportwrench(`${SW_API_BASE}/${encodeURIComponent(eventId)}`);
  if (!res.ok) {
    throw new Error(`Sportwrench event lookup failed for "${eventId}": ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as ApiEventResponse;

  const divRes = await fetchSportwrench(`${SW_API_BASE}/${encodeURIComponent(eventId)}/divisions`);
  if (!divRes.ok) {
    throw new Error(`Sportwrench division lookup failed for "${eventId}": ${divRes.status} ${divRes.statusText}`);
  }
  const divisions = (await divRes.json()) as ApiDivision[];

  return {
    name: data.long_name ?? data.name ?? "",
    divisions: divisions.map((d) => ({ divisionId: d.division_id, name: d.name })),
  };
}

// A division's standings endpoint groups teams by an internal "heading" (e.g. "Div
// 5") -- confirmed against real data (SCVA Power League, event c098ff439) that this
// is just an informational sub-bracket label, not a separate ranking pool: each
// team's own `rank` is already a flat, correctly-tied placement across the WHOLE
// division (ranks like 1,1,1,1,5,5,5,5,9... matching tie-group sizes), so headings
// are flattened away here and every team in the response is treated as one
// division's worth of standings, same granularity as an AES DivisionId.
export type ApiStandingTeam = {
  roster_team_id?: number;
  team_name?: string;
  organization_code?: string;
  club_name?: string;
  division_name?: string; // the division's own display name, e.g. "17U Div 5-20 Event #1"
  rank?: number; // the finish-rank column -- see fetchSportwrenchStandingsRows
};
type ApiStandingsResponse = { teams?: Record<string, ApiStandingTeam[]> };

export async function fetchSportwrenchDivisionStandings(
  eventId: string,
  divisionId: number,
): Promise<ApiStandingTeam[]> {
  const res = await fetchSportwrench(
    `${SW_API_BASE}/${encodeURIComponent(eventId)}/divisions/${divisionId}/standings`,
  );
  if (!res.ok) {
    throw new Error(
      `Sportwrench standings lookup failed for event "${eventId}" division ${divisionId}: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as ApiStandingsResponse;
  return Object.values(data.teams ?? {}).flat();
}

export type SportwrenchStandingRow = RawAesCsvRow & { clubName: string | null };

export type FetchSportwrenchStandingsResult = {
  rows: SportwrenchStandingRow[];
  raw: unknown;
  eventName: string;
  skippedCount: number; // teams missing an organization code or a finish -- can't resolve
};

/**
 * Fetches a Sportwrench event's final standings across every division and maps them
 * into the same row shape aesCsv.ts's parser produces (plus the real club name
 * Sportwrench's JSON gives directly), so the rest of the import pipeline (resolve.ts,
 * commit.ts, the review UI) can consume them unchanged -- mirrors aesStandings.ts.
 *
 * The rank column is sourced from each team's `rank` field, not `seed_current` (an
 * earlier version of this used `seed_current`, matching the field mapping in
 * `AES Scraping/US Club Rankings/usclub_sw.py` -- but confirmed wrong against a real
 * event: `seed_current` comes back 0 for teams that tied for a placement and were
 * never re-seeded afterward, e.g. two real teams that both finished 3rd showed
 * `seed_current: 0` while `rank` correctly showed `3, 3` with the next team at `5`
 * -- proper competition-style ties, matching what Sportwrench's own site displays as
 * the Finish column).
 */
export async function fetchSportwrenchStandingsRows(eventId: string): Promise<FetchSportwrenchStandingsResult> {
  const eventInfo = await fetchSportwrenchEventInfo(eventId);

  const rawByDivision: Record<number, ApiStandingTeam[]> = {};
  const rows: SportwrenchStandingRow[] = [];
  let skippedCount = 0;
  let rowNumber = 0;

  for (const division of eventInfo.divisions) {
    const teams = await fetchSportwrenchDivisionStandings(eventId, division.divisionId);
    rawByDivision[division.divisionId] = teams;

    for (const team of teams) {
      if (!team.organization_code || team.rank == null) {
        skippedCount += 1;
        continue;
      }
      rowNumber += 1;
      rows.push({
        rowNumber,
        ageGroupLabel: team.division_name ?? division.name,
        rank: String(team.rank),
        teamNameField: team.team_name ?? "",
        teamCode: team.organization_code,
        clubName: team.club_name?.trim() || null,
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
