import { fetchVbschedulePage } from "./vbscheduleFetch";
import type { RawAesCsvRow } from "./aesCsv";

const VBS_BASE = "https://vbschedule.com";

export type VbscheduleDivisionRef = { divisionId: string; name: string };
export type VbscheduleEventInfo = { name: string; divisions: VbscheduleDivisionRef[] };

type ApiDivision = { id: string; name: string; is_published?: boolean };
type ApiEventProps = { event: { name: string }; divisions: ApiDivision[] };

export async function fetchVbscheduleEventInfo(eventId: string): Promise<VbscheduleEventInfo> {
  const page = await fetchVbschedulePage<ApiEventProps>(`${VBS_BASE}/events/${encodeURIComponent(eventId)}`);
  return {
    name: page.props.event.name,
    // An unpublished division (confirmed against a real event: e.g. "15 American"
    // shown greyed out with a "Not published" label on the event page) has no
    // reachable .../teams or .../division/{id} page -- fetching one 500s. Filtered
    // out here, once, so every downstream consumer (standings AND match results,
    // both of which start from this same divisions list) skips it automatically.
    divisions: page.props.divisions
      .filter((d) => d.is_published !== false)
      .map((d) => ({ divisionId: d.id, name: d.name })),
  };
}

// A team not yet assigned a finish (e.g. the event's still in progress, or this
// team never played) comes back with finalFinish null -- confirmed against the real
// event data. alternateIdentifier is VBSchedule's structured team code -- same
// fixed-width shape AES's TeamCode uses (gender+ageGroup+clubCode+teamNumber+region,
// see aesTeamCode.ts), which this adapter relies on to reuse that decoder unchanged
// rather than writing a second parser.
export type ApiStandingTeam = {
  id: string;
  name?: string;
  alternateIdentifier?: string | null;
  clubName?: string | null;
  finalFinish?: number | null;
};
type ApiTeamsProps = { division: { name: string }; teams: ApiStandingTeam[] };

export async function fetchVbscheduleDivisionTeams(eventId: string, divisionId: string): Promise<ApiStandingTeam[]> {
  const page = await fetchVbschedulePage<ApiTeamsProps>(
    `${VBS_BASE}/events/${encodeURIComponent(eventId)}/division/${encodeURIComponent(divisionId)}/teams`,
  );
  return page.props.teams;
}

export type VbscheduleStandingRow = RawAesCsvRow & { clubName: string | null };

export type FetchVbscheduleStandingsResult = {
  rows: VbscheduleStandingRow[];
  raw: unknown;
  eventName: string;
  skippedCount: number; // teams missing a team code or a finish -- can't resolve
};

/**
 * Fetches a VBSchedule event's final standings across every division and maps them
 * into the same row shape aesCsv.ts's parser produces (plus the real club name
 * VBSchedule's JSON gives directly), so the rest of the import pipeline (resolve.ts,
 * commit.ts, the review UI) can consume them unchanged -- mirrors
 * aesStandings.ts/sportwrenchStandings.ts.
 */
export async function fetchVbscheduleStandingsRows(eventId: string): Promise<FetchVbscheduleStandingsResult> {
  const eventInfo = await fetchVbscheduleEventInfo(eventId);

  const rawByDivision: Record<string, ApiStandingTeam[]> = {};
  const rows: VbscheduleStandingRow[] = [];
  let skippedCount = 0;
  let rowNumber = 0;

  for (const division of eventInfo.divisions) {
    const teams = await fetchVbscheduleDivisionTeams(eventId, division.divisionId);
    rawByDivision[division.divisionId] = teams;

    for (const team of teams) {
      if (!team.alternateIdentifier || team.finalFinish == null) {
        skippedCount += 1;
        continue;
      }
      rowNumber += 1;
      rows.push({
        rowNumber,
        ageGroupLabel: division.name,
        rank: String(team.finalFinish),
        teamNameField: team.name ?? "",
        teamCode: team.alternateIdentifier,
        clubName: team.clubName?.trim() || null,
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
