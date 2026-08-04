import { fetchTm2Json } from "./tm2Fetch";
import type { RawAesCsvRow } from "./aesCsv";

const TM2_API_BASE = "https://tm2sign.com/api/public";

export type Tm2DivisionRef = { divisionId: number; name: string };
export type Tm2EventInfo = { name: string; divisions: Tm2DivisionRef[] };

type ApiEvent = { id: number; name: string };
type ApiEventDivision = { id: number; event_id: number; name: string };

export async function fetchTm2EventInfo(eventId: string): Promise<Tm2EventInfo> {
  const [event, divisions] = await Promise.all([
    fetchTm2Json<ApiEvent>(`${TM2_API_BASE}/events/${encodeURIComponent(eventId)}`),
    fetchTm2Json<ApiEventDivision[]>(
      `${TM2_API_BASE}/event-divisions?filter[event_id]=${encodeURIComponent(eventId)}`,
    ),
  ]);
  return {
    name: event.name ?? "",
    divisions: divisions.map((d) => ({ divisionId: d.id, name: d.name })),
  };
}

// A team not yet assigned a final finish (event still in progress, or a pool-only
// team that never advanced) is excluded server-side via the `not_null` filter below,
// but the fields are still nullable in the response shape. alternate_identifier is
// TM2's structured team code -- confirmed against a real event (e.g.
// "G16AJVBA1LS" = girls, 16u, club code "AJVBA", team 1, region "LS") to be the exact
// same fixed-width shape AES's TeamCode uses (gender+ageGroup+clubCode+teamNumber+
// region, see aesTeamCode.ts), so this adapter reuses that decoder unchanged rather
// than writing a second parser -- same reasoning as vbscheduleStandings.ts.
export type ApiSchedulerTeam = {
  id: number;
  event_division_id: number;
  alternate_identifier?: string | null;
  name?: string | null;
  club_name?: string | null;
  final_finish_position_number?: number | null;
};

export async function fetchTm2DivisionStandings(divisionId: number): Promise<ApiSchedulerTeam[]> {
  return fetchTm2Json<ApiSchedulerTeam[]>(
    `${TM2_API_BASE}/scheduler-teams?filter[event_division_id]=${divisionId}` +
      `&filter[not_null]=final_finish_position_number&withWinLossStats=false`,
  );
}

export type Tm2StandingRow = RawAesCsvRow & { clubName: string | null };

export type FetchTm2StandingsResult = {
  rows: Tm2StandingRow[];
  raw: unknown;
  eventName: string;
  skippedCount: number; // teams missing a team code or a finish -- can't resolve
};

/**
 * Fetches a TM2 event's final standings across every division and maps them into the
 * same row shape aesCsv.ts's parser produces, so the rest of the import pipeline
 * (resolve.ts, commit.ts, the review UI) can consume them unchanged -- mirrors
 * aesStandings.ts/vbscheduleStandings.ts.
 */
export async function fetchTm2StandingsRows(eventId: string): Promise<FetchTm2StandingsResult> {
  const eventInfo = await fetchTm2EventInfo(eventId);

  const rawByDivision: Record<number, ApiSchedulerTeam[]> = {};
  const rows: Tm2StandingRow[] = [];
  let skippedCount = 0;
  let rowNumber = 0;

  for (const division of eventInfo.divisions) {
    const teams = await fetchTm2DivisionStandings(division.divisionId);
    rawByDivision[division.divisionId] = teams;

    for (const team of teams) {
      if (!team.alternate_identifier || team.final_finish_position_number == null) {
        skippedCount += 1;
        continue;
      }
      rowNumber += 1;
      rows.push({
        rowNumber,
        ageGroupLabel: division.name,
        rank: String(team.final_finish_position_number),
        teamNameField: team.name ?? "",
        teamCode: team.alternate_identifier,
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
